//! When the host shows a native notification about the server's health.
//!
//! The owner is told only what the window cannot tell them: nothing while the window is visible,
//! one notice when the server fails for good, and one when it is back after a long outage while
//! Mawl sits in the tray. The texts are plain prose.

use crate::machine::Status;

/// An outage shorter than this is not worth a "back" notice.
pub const BACK_AFTER_MS: u64 = 30_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Notice {
    pub title: &'static str,
    pub body: &'static str,
}

pub const FAILED: Notice = Notice {
    title: "Mawl could not start",
    body: "Open Mawl to see what went wrong and try again.",
};

pub const BACK: Notice = Notice {
    title: "Mawl is back",
    body: "The server restarted and your teammates are running again.",
};

/// The notification for a status change, if any. `window_visible` means the owner can see the
/// window (shown and not minimized); `outage_ms` is how long the server was down before `next`
/// (0 when it was never up, as at launch).
pub fn notification_for(
    prev: Status,
    next: Status,
    window_visible: bool,
    outage_ms: u64,
) -> Option<Notice> {
    if window_visible {
        return None;
    }
    match (prev, next) {
        // At most one per failed episode: a repeated Failed is the same episode.
        (Status::Failed { .. }, Status::Failed { .. }) => None,
        (_, Status::Failed { .. }) => Some(FAILED),
        (Status::Ready, Status::Ready) => None,
        (_, Status::Ready) if outage_ms > BACK_AFTER_MS => Some(BACK),
        (_, Status::Ready) => None,
        (_, Status::Starting { .. })
        | (_, Status::Restarting { .. })
        | (_, Status::Stopping)
        | (_, Status::Stopped) => None,
    }
}

/// Feeds [`notification_for`] from the supervisor's status stream and measures the outage.
#[derive(Debug)]
pub struct NoticeTracker {
    prev: Status,
    /// When the server last stopped being usable after it had been ready.
    outage_started_ms: Option<u64>,
}

impl NoticeTracker {
    pub fn new(initial: Status) -> Self {
        Self {
            prev: initial,
            outage_started_ms: None,
        }
    }

    /// `now_ms` is a monotonic clock.
    pub fn on_status(&mut self, next: Status, now_ms: u64, window_visible: bool) -> Option<Notice> {
        let prev = self.prev;
        self.prev = next;
        let outage_ms = match next {
            Status::Ready => self
                .outage_started_ms
                .take()
                .map_or(0, |start| now_ms.saturating_sub(start)),
            // A server that was ready and now restarts or fails starts an outage; a quit does not.
            Status::Restarting { .. } => {
                if prev == Status::Ready {
                    self.outage_started_ms = Some(now_ms);
                }
                0
            }
            // A final failure is an outage whenever it began, also a launch that never got ready:
            // a later successful "Try again" then reads as "Mawl is back". One already running
            // (from Ready) keeps its start.
            Status::Failed { .. } => {
                self.outage_started_ms.get_or_insert(now_ms);
                0
            }
            Status::Starting { .. } | Status::Stopping | Status::Stopped => 0,
        };
        notification_for(prev, next, window_visible, outage_ms)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::machine::{Failure, Stage};

    const STARTING: Status = Status::Starting {
        stage: Stage::Database,
    };
    const RESTARTING: Status = Status::Restarting {
        attempt: 1,
        reason: Failure::Unhealthy,
        retry_in_ms: Some(1_000),
    };
    const FAILED_STATUS: Status = Status::Failed {
        reason: Failure::BootTimeout,
    };

    #[test]
    fn a_final_failure_notifies_while_the_window_is_hidden() {
        assert_eq!(
            notification_for(RESTARTING, FAILED_STATUS, false, 0),
            Some(FAILED)
        );
        assert_eq!(
            notification_for(STARTING, FAILED_STATUS, false, 0),
            Some(FAILED)
        );
        assert_eq!(
            notification_for(Status::Ready, FAILED_STATUS, false, 0),
            Some(FAILED)
        );
    }

    #[test]
    fn nothing_is_shown_while_the_window_is_visible() {
        for (prev, next, outage) in [
            (RESTARTING, FAILED_STATUS, 0),
            (STARTING, Status::Ready, 0),
            (RESTARTING, Status::Ready, 120_000),
            (STARTING, Status::Ready, 120_000),
        ] {
            assert_eq!(notification_for(prev, next, true, outage), None);
        }
    }

    #[test]
    fn a_repeated_failed_status_is_the_same_episode() {
        assert_eq!(
            notification_for(FAILED_STATUS, FAILED_STATUS, false, 0),
            None
        );
    }

    #[test]
    fn back_needs_an_outage_over_thirty_seconds() {
        assert_eq!(
            notification_for(STARTING, Status::Ready, false, 30_001),
            Some(BACK)
        );
        assert_eq!(
            notification_for(RESTARTING, Status::Ready, false, 31_000),
            Some(BACK)
        );
        assert_eq!(
            notification_for(STARTING, Status::Ready, false, 30_000),
            None
        );
        assert_eq!(
            notification_for(STARTING, Status::Ready, false, 5_000),
            None
        );
        // The first start at launch has no outage.
        assert_eq!(notification_for(STARTING, Status::Ready, false, 0), None);
        assert_eq!(
            notification_for(Status::Ready, Status::Ready, false, 99_000),
            None
        );
    }

    #[test]
    fn other_transitions_are_silent() {
        for (prev, next) in [
            (Status::Ready, RESTARTING),
            (RESTARTING, STARTING),
            (Status::Ready, Status::Stopping),
            (Status::Stopping, Status::Stopped),
            (FAILED_STATUS, STARTING),
        ] {
            assert_eq!(notification_for(prev, next, false, 999_999), None);
        }
    }

    #[test]
    fn the_tracker_counts_the_outage_across_restart_and_boot() {
        let mut t = NoticeTracker::new(STARTING);
        // Launch: no notice.
        assert_eq!(t.on_status(Status::Ready, 1_000, false), None);
        // Crash, restart, boot, ready 40 s later with the window in the tray.
        assert_eq!(t.on_status(RESTARTING, 10_000, false), None);
        assert_eq!(t.on_status(STARTING, 11_000, false), None);
        assert_eq!(t.on_status(Status::Ready, 50_000, false), Some(BACK));
        // A quick blip is silent.
        assert_eq!(t.on_status(RESTARTING, 60_000, false), None);
        assert_eq!(t.on_status(STARTING, 61_000, false), None);
        assert_eq!(t.on_status(Status::Ready, 70_000, false), None);
        // A long one with the window visible is silent too.
        assert_eq!(t.on_status(RESTARTING, 80_000, true), None);
        assert_eq!(t.on_status(Status::Ready, 200_000, true), None);
    }

    #[test]
    fn the_tracker_notifies_one_failure_per_episode_and_again_after_a_retry() {
        let mut t = NoticeTracker::new(STARTING);
        assert_eq!(t.on_status(RESTARTING, 1_000, false), None);
        assert_eq!(t.on_status(FAILED_STATUS, 2_000, false), Some(FAILED));
        assert_eq!(t.on_status(FAILED_STATUS, 3_000, false), None);
        // "Try again", then it fails for good again: a new episode.
        assert_eq!(t.on_status(STARTING, 4_000, false), None);
        assert_eq!(t.on_status(FAILED_STATUS, 9_000, false), Some(FAILED));
    }

    #[test]
    fn a_retry_that_works_after_a_failed_launch_says_back() {
        let mut t = NoticeTracker::new(STARTING);
        // The very first start fails for good with the window in the tray.
        assert_eq!(t.on_status(RESTARTING, 1_000, false), None);
        assert_eq!(t.on_status(FAILED_STATUS, 2_000, false), Some(FAILED));
        // "Try again" works 40 s after the failure.
        assert_eq!(t.on_status(STARTING, 40_000, false), None);
        assert_eq!(t.on_status(Status::Ready, 42_001, false), Some(BACK));
        // The outage is over: a later blip is judged on its own.
        assert_eq!(t.on_status(Status::Ready, 50_000, false), None);
    }

    #[test]
    fn a_quick_retry_after_a_failure_is_silent_and_a_failure_from_ready_keeps_its_start() {
        let mut t = NoticeTracker::new(STARTING);
        assert_eq!(t.on_status(FAILED_STATUS, 1_000, false), Some(FAILED));
        assert_eq!(t.on_status(STARTING, 2_000, false), None);
        assert_eq!(t.on_status(Status::Ready, 20_000, false), None);

        // Ready, restarts for a while, then fails: the outage began at the first restart.
        assert_eq!(t.on_status(RESTARTING, 100_000, false), None);
        assert_eq!(t.on_status(FAILED_STATUS, 130_000, false), Some(FAILED));
        assert_eq!(t.on_status(STARTING, 131_000, false), None);
        assert_eq!(t.on_status(Status::Ready, 132_000, false), Some(BACK));
    }

    #[test]
    fn a_quit_is_not_an_outage() {
        let mut t = NoticeTracker::new(STARTING);
        t.on_status(Status::Ready, 0, false);
        assert_eq!(t.on_status(Status::Stopping, 10_000, false), None);
        assert_eq!(t.on_status(Status::Stopped, 100_000, false), None);
    }
}
