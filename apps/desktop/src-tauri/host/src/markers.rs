//! One-time markers in the host's data dir ("this hint was shown", "autostart was set up"): tiny
//! files whose existence is the flag, in the style of the remembered port (`port.rs`).

use std::fs::{self, OpenOptions};
use std::io::{ErrorKind, Write};
use std::path::Path;

pub const FIRST_CLOSE_HINT_FILE: &str = "close-hint-shown";
pub const AUTOSTART_INITIALISED_FILE: &str = "autostart_initialised";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Claim {
    /// The marker did not exist and was created now: this caller is the first.
    First,
    /// The marker already existed.
    Done,
    /// The marker could not be created (read-only dir, full disk). Callers pick the safe side.
    Unwritable,
}

/// Creates `<data_dir>/<name>` atomically; only one caller ever gets [`Claim::First`].
pub fn claim(data_dir: &Path, name: &str) -> Claim {
    if fs::create_dir_all(data_dir).is_err() {
        return Claim::Unwritable;
    }
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(data_dir.join(name))
    {
        // The marker exists from here on, so a failed write of its content does not matter.
        Ok(mut file) => {
            let _ = file.write_all(b"1");
            Claim::First
        }
        Err(e) if e.kind() == ErrorKind::AlreadyExists => Claim::Done,
        Err(_) => Claim::Unwritable,
    }
}

/// Removes the marker so the next run is `First` again. Used when what the marker stands for did
/// not happen (a toast that failed to show, a login item that could not be set). A marker that is
/// not there is fine; false means it could not be removed.
pub fn release(data_dir: &Path, name: &str) -> bool {
    match fs::remove_file(data_dir.join(name)) {
        Ok(()) => true,
        Err(e) => e.kind() == ErrorKind::NotFound,
    }
}

/// True when the "Mawl is still running" hint should be shown now: the first time the window is
/// closed to the tray. A failed write never blocks the close; it still shows the hint (the caller
/// shows it at most once per process, so a read-only data dir cannot make it repeat).
pub fn first_close_hint(data_dir: &Path) -> bool {
    !matches!(claim(data_dir, FIRST_CLOSE_HINT_FILE), Claim::Done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mawl-markers-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn the_first_claim_wins_and_creates_the_dir() {
        let dir = temp("claim");
        assert_eq!(claim(&dir, "m"), Claim::First);
        assert_eq!(claim(&dir, "m"), Claim::Done);
        assert_eq!(claim(&dir, "other"), Claim::First);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_released_marker_can_be_claimed_again() {
        let dir = temp("release");
        assert_eq!(claim(&dir, "m"), Claim::First);
        assert!(release(&dir, "m"));
        assert_eq!(claim(&dir, "m"), Claim::First);
        // Releasing what is not there, or in a dir that is not there, is not an error.
        assert!(release(&dir, "never-claimed"));
        assert!(release(&dir.join("missing"), "m"));
        // Other markers are untouched.
        assert_eq!(claim(&dir, "other"), Claim::First);
        assert!(release(&dir, "m"));
        assert_eq!(claim(&dir, "other"), Claim::Done);
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_unwritable_dir_is_reported_not_raised() {
        // A file where the directory should be: create_dir_all fails.
        let dir = temp("blocked");
        fs::write(&dir, "x").unwrap();
        assert_eq!(claim(&dir.join("sub"), "m"), Claim::Unwritable);
        fs::remove_file(&dir).unwrap();
    }

    #[test]
    fn the_close_hint_shows_once_and_still_shows_when_the_write_fails() {
        let dir = temp("hint");
        assert!(first_close_hint(&dir));
        assert!(!first_close_hint(&dir));
        fs::remove_dir_all(&dir).unwrap();

        let blocked = temp("hint-blocked");
        fs::write(&blocked, "x").unwrap();
        assert!(first_close_hint(&blocked.join("sub")));
        fs::remove_file(&blocked).unwrap();
    }
}
