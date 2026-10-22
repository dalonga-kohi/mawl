//! What the host does when Windows logs off, shuts down or wakes from sleep. The window messages
//! arrive in `src/session_end.rs` (the only `unsafe`); which one means what, and how long to wait,
//! is decided here so it runs under `cargo test`.
//!
//! Without this, a logoff can end the host with no `ExitRequested`: the job object then kills the
//! embedded Postgres hard and the next start runs WAL recovery.

use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

// Win32 message and notification numbers. `src/session_end.rs` asserts at compile time that they
// equal `windows-sys`' constants, so a typo here cannot go unnoticed.
pub const WM_QUERYENDSESSION: u32 = 0x0011;
pub const WM_ENDSESSION: u32 = 0x0016;
pub const WM_POWERBROADCAST: u32 = 0x0218;
pub const PBT_APMRESUMEAUTOMATIC: u32 = 0x0012;

/// How long `WM_ENDSESSION` waits for the server to stop. Windows gives a GUI app about five
/// seconds after `WM_ENDSESSION` before it ends the process anyway, so waiting longer buys
/// nothing; the server's clean stop began earlier, at `WM_QUERYENDSESSION`, and often finishes
/// inside this. If it does not, the job object ends the rest and the next start recovers.
pub const END_SESSION_WAIT: Duration = Duration::from_millis(4_500);
/// How often the wait looks at whether the server has stopped.
pub const WAIT_STEP: Duration = Duration::from_millis(50);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SessionAction {
    /// Not ours: leave it to the window's own handling.
    Ignore,
    /// Windows asks whether it may end the session. Never veto: answer yes, tell Windows why
    /// Mawl is busy and start the clean stop now.
    AllowAndStopServer,
    /// The session is ending for real: wait (bounded) for the server to stop, then let it go.
    WaitForStop,
    /// The session end was called off by someone else. Mawl is already stopping and quits.
    EndCancelled,
    /// The PC woke from sleep: probe the server now.
    ProbeNow,
}

/// Maps a window message to what the host does. `wparam` is the message's first parameter.
pub fn session_action(msg: u32, wparam: usize) -> SessionAction {
    match msg {
        WM_QUERYENDSESSION => SessionAction::AllowAndStopServer,
        // The parameter is a BOOL: TRUE when the session is really ending.
        WM_ENDSESSION if (wparam as u32) != 0 => SessionAction::WaitForStop,
        WM_ENDSESSION => SessionAction::EndCancelled,
        WM_POWERBROADCAST if wparam == PBT_APMRESUMEAUTOMATIC as usize => SessionAction::ProbeNow,
        _ => SessionAction::Ignore,
    }
}

/// Lets exactly one window handler do the bounded wait for a session end. Every top-level window
/// of the UI thread gets `WM_ENDSESSION`, and the later ones find the work done (or timed out).
#[derive(Debug, Default)]
pub struct EndWait(AtomicBool);

impl EndWait {
    pub const fn new() -> Self {
        Self(AtomicBool::new(false))
    }

    /// True for the first caller only.
    pub fn claim(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}

/// Polls `done` every `step` for at most `limit`; true as soon as it holds, false on the deadline.
/// One last check happens at the deadline.
pub fn wait_bounded(done: impl Fn() -> bool, limit: Duration, step: Duration) -> bool {
    let mut waited = Duration::ZERO;
    while !done() {
        if waited >= limit {
            return false;
        }
        let nap = step.min(limit - waited);
        thread::sleep(nap);
        waited += nap;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    #[test]
    fn the_query_is_never_vetoed_and_starts_the_stop() {
        for wparam in [0, 1, usize::MAX] {
            assert_eq!(
                session_action(WM_QUERYENDSESSION, wparam),
                SessionAction::AllowAndStopServer
            );
        }
    }

    #[test]
    fn a_real_end_waits_and_a_called_off_one_does_not() {
        assert_eq!(session_action(WM_ENDSESSION, 1), SessionAction::WaitForStop);
        // Only the low 32 bits are the BOOL.
        assert_eq!(
            session_action(WM_ENDSESSION, 0x1_0000_0001),
            SessionAction::WaitForStop
        );
        assert_eq!(
            session_action(WM_ENDSESSION, 0),
            SessionAction::EndCancelled
        );
        assert_eq!(
            session_action(WM_ENDSESSION, 0x1_0000_0000),
            SessionAction::EndCancelled
        );
    }

    #[test]
    fn only_the_automatic_resume_probes() {
        assert_eq!(
            session_action(WM_POWERBROADCAST, PBT_APMRESUMEAUTOMATIC as usize),
            SessionAction::ProbeNow
        );
        // Suspend (4), resume-suspend (7), battery low (9), status change (10): nothing to do.
        for wparam in [0, 4, 7, 9, 10, 11, 19] {
            assert_eq!(
                session_action(WM_POWERBROADCAST, wparam),
                SessionAction::Ignore,
                "{wparam}"
            );
        }
    }

    #[test]
    fn only_the_first_window_waits_for_the_end_of_the_session() {
        // The message goes to every subclassed window in turn; waiting in each would add up.
        let gate = EndWait::new();
        assert!(gate.claim());
        assert!(!gate.claim());
        assert!(!gate.claim());
    }

    #[test]
    fn other_messages_are_ignored() {
        for msg in [
            0, 0x0010, /* WM_CLOSE */
            0x0012, /* WM_QUIT */
            0x0113,
        ] {
            assert_eq!(session_action(msg, 1), SessionAction::Ignore, "{msg}");
        }
    }

    #[test]
    fn the_wait_fits_inside_what_windows_allows() {
        assert!(END_SESSION_WAIT < Duration::from_secs(5));
        assert!(WAIT_STEP < END_SESSION_WAIT);
    }

    #[test]
    fn the_wait_returns_at_once_when_already_done() {
        assert!(wait_bounded(
            || true,
            Duration::from_secs(60),
            Duration::from_secs(60)
        ));
    }

    #[test]
    fn the_wait_ends_when_the_condition_turns_true() {
        let polls = AtomicU32::new(0);
        let done = || polls.fetch_add(1, Ordering::SeqCst) >= 3;
        assert!(wait_bounded(
            done,
            Duration::from_secs(5),
            Duration::from_millis(1)
        ));
        assert_eq!(polls.load(Ordering::SeqCst), 4);
    }

    #[test]
    fn the_wait_gives_up_at_the_deadline_with_one_last_check() {
        let polls = AtomicU32::new(0);
        let done = || {
            polls.fetch_add(1, Ordering::SeqCst);
            false
        };
        assert!(!wait_bounded(
            done,
            Duration::from_millis(5),
            Duration::from_millis(1)
        ));
        // Five 1 ms steps, a check before each and one at the deadline.
        assert_eq!(polls.load(Ordering::SeqCst), 6);
    }

    #[test]
    fn a_step_longer_than_the_limit_is_cut_short() {
        let started = std::time::Instant::now();
        assert!(!wait_bounded(
            || false,
            Duration::from_millis(10),
            Duration::from_secs(30)
        ));
        assert!(started.elapsed() < Duration::from_secs(5));
    }
}
