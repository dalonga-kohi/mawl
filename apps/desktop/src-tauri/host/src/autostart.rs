//! Starting Mawl at login: the launch argument, the hidden start and the "on by default, once" rule.

use std::path::Path;

use crate::markers::{claim, Claim, AUTOSTART_INITIALISED_FILE};

/// The argument the OS passes when it starts Mawl at login.
pub const AUTOSTART_ARG: &str = "--autostart";

/// Whether this launch came from the login item: the window stays in the tray. Only the exact
/// flag counts (case-sensitive); `mawl://` links and other arguments do not.
pub fn launched_hidden(args: &[String]) -> bool {
    args.iter().any(|a| a == AUTOSTART_ARG)
}

/// True only on the very first run: autostart is switched on then, and afterwards the owner's
/// choice stands, so it is never switched on again. When the marker cannot be written the answer
/// is no, because a repeat could undo a choice the owner made.
pub fn enable_by_default(data_dir: &Path) -> bool {
    claim(data_dir, AUTOSTART_INITIALISED_FILE) == Claim::First
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn only_the_exact_flag_hides_the_window() {
        assert!(launched_hidden(&args(&["Mawl.exe", "--autostart"])));
        assert!(launched_hidden(&args(&["--autostart", "mawl://t/sam"])));
        assert!(!launched_hidden(&args(&["Mawl.exe"])));
        assert!(!launched_hidden(&args(&[])));
        assert!(!launched_hidden(&args(&["Mawl.exe", "--AUTOSTART"])));
        assert!(!launched_hidden(&args(&["Mawl.exe", "--autostart=1"])));
        assert!(!launched_hidden(&args(&["Mawl.exe", "-autostart"])));
        assert!(!launched_hidden(&args(&["mawl://autostart", "--autostar"])));
        assert!(!launched_hidden(&args(&["mawl://t/--autostart"])));
    }

    #[test]
    fn autostart_turns_on_by_default_once() {
        let dir = std::env::temp_dir().join(format!("mawl-autostart-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert!(enable_by_default(&dir));
        assert!(!enable_by_default(&dir));
        assert!(!enable_by_default(&dir));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn an_unwritable_data_dir_never_enables_autostart() {
        let blocked = std::env::temp_dir().join(format!("mawl-autostart-b-{}", std::process::id()));
        let _ = fs::remove_file(&blocked);
        fs::write(&blocked, "x").unwrap();
        assert!(!enable_by_default(&blocked.join("sub")));
        fs::remove_file(&blocked).unwrap();
    }
}
