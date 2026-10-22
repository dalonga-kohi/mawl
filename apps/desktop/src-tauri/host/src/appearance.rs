//! The owner's theme and accent for the splash.
//!
//! The web app keeps them in its origin's localStorage (`mawl.appearance`), which the splash (on
//! Tauri's origin) cannot read, and the app page has no IPC to tell the host. So the host pulls:
//! it runs [`READ_SCRIPT`] in the app page (`eval_with_callback`) when the window leaves the app,
//! hides to the tray or quits, checks the answer strictly ([`parse_eval_result`]) and keeps it in
//! `<data>/appearance.json`, which the splash reads through a host command. The page's answer is
//! untrusted (a remote Mawl's page could write anything there): only a known theme, a `#RRGGBB`
//! accent and a boolean survive, and nothing else from the page is ever stored.

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const APPEARANCE_FILE: &str = "appearance.json";
/// The page's localStorage key (`apps/web/src/appearance/prefs.ts`).
pub const STORAGE_KEY: &str = "mawl.appearance";
/// Bigger answers are not the web app's appearance.
const MAX_ANSWER: usize = 4 * 1024;

/// Returns the raw stored string or `null`; never throws (storage can be blocked).
pub const READ_SCRIPT: &str = r#"(function () {
  try { return window.localStorage.getItem("mawl.appearance"); } catch (e) { return null; }
})()"#;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Theme {
    System,
    Light,
    Dark,
}

/// What the splash applies. Field names match the web app's `Appearance`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Appearance {
    pub theme: Theme,
    /// `#RRGGBB`; `None` keeps the splash's default accent.
    pub accent: Option<String>,
    pub reduce_motion: bool,
}

/// `#` and six hex digits, upper-cased.
fn accent_hex(value: &serde_json::Value) -> Option<String> {
    let text = value.as_str()?;
    let digits = text.strip_prefix('#')?;
    (digits.len() == 6 && digits.bytes().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", digits.to_ascii_uppercase()))
}

/// Checks a stored appearance object the way the web app reads it: each field falls back on its
/// own, an accent that is not `#RRGGBB` is dropped.
fn from_value(value: &serde_json::Value) -> Option<Appearance> {
    let object = value.as_object()?;
    let theme = match object.get("theme").and_then(serde_json::Value::as_str) {
        Some("light") => Theme::Light,
        Some("dark") => Theme::Dark,
        _ => Theme::System,
    };
    Some(Appearance {
        theme,
        accent: object.get("accent").and_then(accent_hex),
        reduce_motion: object
            .get("reduceMotion")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    })
}

/// The JSON `eval_with_callback` hands back for [`READ_SCRIPT`]: `null`, or a JSON string holding
/// the stored JSON. `None` for anything else (no appearance saved, or not the web app's).
pub fn parse_eval_result(result: &str) -> Option<Appearance> {
    if result.len() > MAX_ANSWER {
        return None;
    }
    let stored: String = serde_json::from_str(result).ok()?;
    let value: serde_json::Value = serde_json::from_str(&stored).ok()?;
    from_value(&value)
}

pub fn save(data_dir: &Path, appearance: &Appearance) -> io::Result<()> {
    let text = serde_json::to_string(appearance).map_err(io::Error::other)?;
    fs::create_dir_all(data_dir)?;
    let partial = data_dir.join(format!("{APPEARANCE_FILE}.partial"));
    fs::write(&partial, text)?;
    fs::rename(&partial, data_dir.join(APPEARANCE_FILE))
}

/// The saved appearance, checked again on the way in. `None` when there is none.
pub fn load(data_dir: &Path) -> Option<Appearance> {
    let text = fs::read_to_string(data_dir.join(APPEARANCE_FILE)).ok()?;
    if text.len() > MAX_ANSWER {
        return None;
    }
    from_value(&serde_json::from_str(&text).ok()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What WebView2 returns for a string result: the string, JSON-encoded.
    fn answer(stored: &str) -> String {
        serde_json::to_string(stored).unwrap()
    }

    #[test]
    fn reads_what_the_web_app_stores() {
        let stored = r##"{"theme":"dark","accent":"#f7c4a3","reduceMotion":true}"##;
        assert_eq!(
            parse_eval_result(&answer(stored)),
            Some(Appearance {
                theme: Theme::Dark,
                accent: Some("#F7C4A3".into()),
                reduce_motion: true,
            })
        );
    }

    #[test]
    fn nothing_saved_or_not_an_object_is_none() {
        assert_eq!(parse_eval_result("null"), None);
        assert_eq!(parse_eval_result(""), None);
        assert_eq!(parse_eval_result("42"), None);
        assert_eq!(parse_eval_result(&answer("not json")), None);
        assert_eq!(parse_eval_result(&answer("[1,2]")), None);
        assert_eq!(parse_eval_result(&answer(&"x".repeat(5000))), None);
        // An answer that is itself the object (not a string) is not what the script returns.
        assert_eq!(parse_eval_result(r#"{"theme":"dark"}"#), None);
    }

    #[test]
    fn untrusted_fields_fall_back_one_by_one() {
        let stored = r#"{"theme":"neon","accent":"red; background:url(x)","reduceMotion":"yes","extra":"<script>"}"#;
        assert_eq!(
            parse_eval_result(&answer(stored)),
            Some(Appearance {
                theme: Theme::System,
                accent: None,
                reduce_motion: false,
            })
        );
        for bad in ["#12345", "#1234567", "#GGGGGG", "123456", "lime", ""] {
            let stored = format!(r#"{{"theme":"light","accent":"{bad}"}}"#);
            assert_eq!(
                parse_eval_result(&answer(&stored)).unwrap().accent,
                None,
                "{bad}"
            );
        }
    }

    #[test]
    fn saves_and_loads_and_checks_the_file_again() {
        let dir = std::env::temp_dir().join(format!("mawl-appearance-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), None);
        let look = Appearance {
            theme: Theme::Light,
            accent: Some("#4F46E5".into()),
            reduce_motion: false,
        };
        save(&dir, &look).unwrap();
        assert_eq!(load(&dir), Some(look));
        // A hand-edited file goes through the same checks.
        fs::write(
            dir.join(APPEARANCE_FILE),
            r#"{"theme":"dark","accent":"url(evil)","reduceMotion":true}"#,
        )
        .unwrap();
        assert_eq!(
            load(&dir),
            Some(Appearance {
                theme: Theme::Dark,
                accent: None,
                reduce_motion: true,
            })
        );
        fs::write(dir.join(APPEARANCE_FILE), "garbage").unwrap();
        assert_eq!(load(&dir), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_script_reads_the_web_apps_key_and_cannot_throw() {
        assert!(READ_SCRIPT.contains(&format!("getItem(\"{STORAGE_KEY}\")")));
        assert!(READ_SCRIPT.contains("catch"));
    }
}
