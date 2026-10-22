//! Whether the main window shows the app or the splash, decided together with whether the server
//! is ready.
//!
//! The supervisor thread reports status changes and asks the window to leave the app, while the
//! splash's command and a fallback timer ask it to enter. If "is the server ready" and "is the
//! window in the app" were read and written separately, a crash between the check and the
//! navigation would leave the window on a dead port with `in_app` set, and the next ready would not
//! navigate. Here both live behind one mutex and the navigation runs under it, so a leave can never
//! interleave with an enter.
//!
//! The navigation callbacks must not take this lock again (they only start a navigation). The
//! navigation guard reads [`Presence::app_allowed`], which is lock-free.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use crate::machine::Status;

#[derive(Default)]
struct State {
    ready: bool,
    in_app: bool,
}

#[derive(Default)]
pub struct Presence {
    state: Mutex<State>,
    /// A copy of `state.ready`, written under the lock, for the navigation guard.
    ready_flag: AtomicBool,
}

impl Presence {
    pub fn new() -> Self {
        Self::default()
    }

    /// The supervisor's status changed. Only a ready server may be entered.
    pub fn set_ready(&self, ready: bool) {
        let mut state = self.lock();
        state.ready = ready;
        self.ready_flag.store(ready, Ordering::SeqCst);
    }

    /// The supervisor's status changed: only `Ready` allows the app.
    pub fn note_status(&self, status: Status) {
        self.set_ready(status == Status::Ready);
    }

    /// Whether the app origin may be loaded right now (the navigation rule).
    pub fn app_allowed(&self) -> bool {
        self.ready_flag.load(Ordering::SeqCst)
    }

    /// Runs `navigate_to_app` and returns true only when the server is ready at this instant and
    /// the window is not in the app yet.
    pub fn try_enter(&self, navigate_to_app: impl FnOnce()) -> bool {
        let mut state = self.lock();
        if !state.ready || state.in_app {
            return false;
        }
        state.in_app = true;
        navigate_to_app();
        true
    }

    /// A deep link arrived. When the server is ready at this instant the window goes to the link
    /// (`navigate_to_link`) and counts as in the app, whatever page it was on; otherwise
    /// `defer` runs, still under the lock, so a ready that lands right after cannot miss the link:
    /// the enter that follows reads what `defer` stored. Returns whether the window navigated.
    pub fn open_link(&self, navigate_to_link: impl FnOnce(), defer: impl FnOnce()) -> bool {
        let mut state = self.lock();
        if !state.ready {
            defer();
            return false;
        }
        state.in_app = true;
        navigate_to_link();
        true
    }

    /// The server is going away: not ready any more, and back to the splash when the window was
    /// in the app.
    pub fn leave(&self, navigate_to_splash: impl FnOnce()) -> bool {
        let mut state = self.lock();
        state.ready = false;
        self.ready_flag.store(false, Ordering::SeqCst);
        if !state.in_app {
            return false;
        }
        state.in_app = false;
        navigate_to_splash();
        true
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::{Failure, Stage};
    use std::cell::RefCell;

    /// Records navigations and tracks which page the fake window ends on.
    #[derive(Default)]
    struct FakeWindow {
        page: RefCell<&'static str>,
        log: RefCell<Vec<&'static str>>,
    }

    impl FakeWindow {
        fn new() -> Self {
            let w = Self::default();
            *w.page.borrow_mut() = "splash";
            w
        }
        fn go(&self, page: &'static str) {
            *self.page.borrow_mut() = page;
            self.log.borrow_mut().push(page);
        }
        fn page(&self) -> &'static str {
            *self.page.borrow()
        }
    }

    #[test]
    fn enters_only_while_ready() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        assert!(!presence.try_enter(|| window.go("app")));
        assert_eq!(window.page(), "splash");
        presence.set_ready(true);
        assert!(presence.try_enter(|| window.go("app")));
        assert_eq!(window.page(), "app");
    }

    #[test]
    fn a_link_while_ready_navigates_and_counts_as_entered() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        assert!(presence.open_link(|| window.go("link"), || window.go("deferred")));
        assert_eq!(window.page(), "link");
        // The window is in the app: the fallback enter must not navigate over the link.
        assert!(!presence.try_enter(|| window.go("app")));
        assert_eq!(*window.log.borrow(), vec!["link"]);
        // A second link navigates again.
        assert!(presence.open_link(|| window.go("link2"), || window.go("deferred")));
        assert_eq!(window.page(), "link2");
    }

    #[test]
    fn a_link_before_ready_is_deferred_and_the_enter_picks_it_up() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        let pending = crate::deep_link::PendingLink::new();
        assert!(!presence.open_link(|| window.go("link"), || pending.set("/t/ada".into())));
        assert_eq!(window.page(), "splash");
        presence.set_ready(true);
        assert!(presence.try_enter(|| {
            window.go(if pending.take().is_some() {
                "link"
            } else {
                "app"
            })
        }));
        assert_eq!(window.page(), "link");
    }

    #[test]
    fn a_link_after_a_crash_is_deferred_not_sent_to_a_dead_port() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        assert!(presence.try_enter(|| window.go("app")));
        presence.leave(|| window.go("splash"));
        assert!(!presence.open_link(|| window.go("link"), || window.go("deferred")));
        assert_eq!(*window.log.borrow(), vec!["app", "splash", "deferred"]);
    }

    #[test]
    fn a_second_enter_does_not_navigate_again() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        assert!(presence.try_enter(|| window.go("app")));
        assert!(!presence.try_enter(|| window.go("app")));
        assert_eq!(*window.log.borrow(), vec!["app"]);
    }

    #[test]
    fn a_late_enter_after_a_crash_stays_on_the_splash() {
        // Ready, the 3 s fallback is pending, the server crashes, then the fallback fires.
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        presence.set_ready(false);
        assert!(!presence.leave(|| window.go("splash")));
        assert!(!presence.try_enter(|| window.go("app")));
        assert_eq!(window.page(), "splash");
        assert!(window.log.borrow().is_empty());
    }

    #[test]
    fn leave_returns_to_the_splash_and_the_next_ready_enters_again() {
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        assert!(presence.try_enter(|| window.go("app")));
        assert!(presence.leave(|| window.go("splash")));
        assert_eq!(window.page(), "splash");
        // The old server's late enter finds it not ready.
        assert!(!presence.try_enter(|| window.go("app")));
        presence.set_ready(true);
        assert!(presence.try_enter(|| window.go("app")));
        assert_eq!(window.page(), "app");
    }

    #[test]
    fn a_leave_that_reaches_the_lock_first_clears_ready_for_a_late_ready_check() {
        // `leave` without a prior `set_ready(false)` (the effect arrives before the status).
        let presence = Presence::new();
        let window = FakeWindow::new();
        presence.set_ready(true);
        presence.leave(|| window.go("splash"));
        assert!(!presence.try_enter(|| window.go("app")));
        assert!(!presence.app_allowed());
    }

    #[test]
    fn the_app_origin_is_allowed_only_while_ready() {
        let presence = Presence::new();
        assert!(!presence.app_allowed());
        presence.set_ready(true);
        assert!(presence.app_allowed());
        presence.set_ready(false);
        assert!(!presence.app_allowed());
    }

    #[test]
    fn only_a_ready_status_allows_the_app_origin() {
        let presence = Presence::new();
        let reason = Failure::Unhealthy;
        let cases = [
            (
                Status::Starting {
                    stage: Stage::Database,
                },
                false,
            ),
            (
                Status::Starting {
                    stage: Stage::Server,
                },
                false,
            ),
            (Status::Ready, true),
            (
                Status::Restarting {
                    attempt: 1,
                    reason,
                    retry_in_ms: None,
                },
                false,
            ),
            (
                Status::Restarting {
                    attempt: 2,
                    reason,
                    retry_in_ms: Some(2_000),
                },
                false,
            ),
            (Status::Stopping, false),
            (Status::Stopped, false),
            (Status::Failed { reason }, false),
        ];
        for (status, allowed) in cases {
            presence.note_status(status);
            assert_eq!(presence.app_allowed(), allowed, "{status:?}");
            assert_eq!(presence.try_enter(|| {}), allowed, "{status:?}");
            presence.leave(|| {});
        }
    }

    #[test]
    fn enter_and_leave_never_interleave_across_threads() {
        use std::sync::Arc;
        use std::thread;
        // The navigation closures observe that the other side is not mid-navigation.
        let presence = Arc::new(Presence::new());
        let inside = Arc::new(AtomicBool::new(false));
        let mut handles = Vec::new();
        for i in 0..4 {
            let presence = Arc::clone(&presence);
            let inside = Arc::clone(&inside);
            handles.push(thread::spawn(move || {
                for n in 0..500 {
                    let check = || {
                        assert!(
                            !inside.swap(true, Ordering::SeqCst),
                            "navigations overlapped"
                        );
                        inside.store(false, Ordering::SeqCst);
                    };
                    match (i + n) % 3 {
                        0 => presence.set_ready(true),
                        1 => {
                            presence.try_enter(check);
                        }
                        _ => {
                            presence.leave(check);
                        }
                    }
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
    }
}
