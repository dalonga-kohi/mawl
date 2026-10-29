//! The owner's theme and palette for the splash, and the window background to paint before it.
//!
//! The web app keeps them in its origin's localStorage (`mawl.appearance`), which the splash (on
//! Tauri's origin) cannot read, and the app page has no IPC to tell the host. So the host pulls:
//! it runs [`READ_SCRIPT`] in the app page (`eval_with_callback`) when the window leaves the app,
//! hides to the tray or quits, checks the answer strictly ([`parse_eval_result`]) and keeps it in
//! `<data>/appearance.json`, which the splash reads through a host command. The script also reads
//! the page's painted `--bg`, so the next launch paints the window in that colour before the web
//! view's first frame (no white flash). The page's answer is untrusted (a remote Mawl's page could
//! write anything there): only a known theme, a palette name of a plain shape, a `#RRGGBB`
//! background and a boolean survive, and nothing else from the page is ever stored. Which palette
//! names exist is the web app's call (it falls back to Mawl for one it does not know).

use std::fs;
use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};

pub const APPEARANCE_FILE: &str = "appearance.json";
/// The page's localStorage key (`apps/web/src/appearance/prefs.ts`).
pub const STORAGE_KEY: &str = "mawl.appearance";
/// Bigger answers are not the web app's appearance.
const MAX_ANSWER: usize = 4 * 1024;
/// Palette ids are short kebab-case words (`mawl`, `rose-pine`).
const MAX_PALETTE: usize = 32;

/// Returns the stored appearance object with the painted `--bg` added, as a JSON string. Never
/// throws: storage can be blocked and the stored value can be anything.
pub const READ_SCRIPT: &str = r#"(function () {
  var look = {};
  try {
    var raw = window.localStorage.getItem("mawl.appearance");
    var value = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && !Array.isArray(value)) look = value;
  } catch (e) {}
  try {
    look.bg = window.getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  } catch (e) {}
  try { return JSON.stringify(look); } catch (e) { return null; }
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
    /// A palette id of a plain shape; `None` keeps the splash's default (Mawl).
    pub palette: Option<String>,
    /// `#RRGGBB`, the page's painted background; `None` keeps the platform default.
    pub bg: Option<String>,
    pub reduce_motion: bool,
}

/// `#` and six hex digits, upper-cased.
fn hex_color(value: &serde_json::Value) -> Option<String> {
    let text = value.as_str()?;
    let digits = text.strip_prefix('#')?;
    (digits.len() == 6 && digits.bytes().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", digits.to_ascii_uppercase()))
}

/// Lower-case letters, digits and inner hyphens, starting with a letter.
fn palette_id(value: &serde_json::Value) -> Option<String> {
    let text = value.as_str()?;
    let bytes = text.as_bytes();
    let plain = !bytes.is_empty()
        && bytes.len() <= MAX_PALETTE
        && bytes[0].is_ascii_lowercase()
        && !text.ends_with('-')
        && bytes
            .iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-');
    plain.then(|| text.to_owned())
}

/// `(r, g, b)` of a `#RRGGBB` the checks above produced.
pub fn rgb(hex: &str) -> Option<(u8, u8, u8)> {
    let digits = hex.strip_prefix('#')?;
    if digits.len() != 6 {
        return None;
    }
    let n = u32::from_str_radix(digits, 16).ok()?;
    Some(((n >> 16) as u8, (n >> 8) as u8, n as u8))
}

/// Checks a stored appearance object the way the web app reads it: each field falls back on its
/// own; a palette or background of the wrong shape is dropped.
fn from_value(value: &serde_json::Value) -> Option<Appearance> {
    let object = value.as_object()?;
    let theme = match object.get("theme").and_then(serde_json::Value::as_str) {
        Some("light") => Theme::Light,
        Some("dark") => Theme::Dark,
        _ => Theme::System,
    };
    Some(Appearance {
        theme,
        palette: object.get("palette").and_then(palette_id),
        bg: object.get("bg").and_then(hex_color),
        reduce_motion: object
            .get("reduceMotion")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    })
}

/// The JSON `eval_with_callback` hands back for [`READ_SCRIPT`]: a JSON string holding the
/// appearance JSON. `None` for anything else.
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
    fn reads_what_the_web_app_stores_and_the_painted_background() {
        let stored =
            r##"{"theme":"dark","palette":"rose-pine","reduceMotion":true,"bg":"#0b1019"}"##;
        assert_eq!(
            parse_eval_result(&answer(stored)),
            Some(Appearance {
                theme: Theme::Dark,
                palette: Some("rose-pine".into()),
                bg: Some("#0B1019".into()),
                reduce_motion: true,
            })
        );
    }

    #[test]
    fn nothing_saved_still_keeps_the_background() {
        assert_eq!(
            parse_eval_result(&answer(r##"{"bg":"#F5F7FC"}"##)),
            Some(Appearance {
                theme: Theme::System,
                palette: None,
                bg: Some("#F5F7FC".into()),
                reduce_motion: false,
            })
        );
    }

    #[test]
    fn not_an_object_is_none() {
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
        let stored = r#"{"theme":"neon","palette":"x; background:url(x)","bg":"red","reduceMotion":"yes","extra":"<script>"}"#;
        assert_eq!(
            parse_eval_result(&answer(stored)),
            Some(Appearance {
                theme: Theme::System,
                palette: None,
                bg: None,
                reduce_motion: false,
            })
        );
        for bad in [
            "#12345",
            "#1234567",
            "#GGGGGG",
            "123456",
            "lime",
            "",
            "rgb(1,2,3)",
        ] {
            let stored = format!(r#"{{"theme":"light","bg":"{bad}"}}"#);
            assert_eq!(
                parse_eval_result(&answer(&stored)).unwrap().bg,
                None,
                "{bad}"
            );
        }
        for bad in [
            "",
            "Mawl",
            "-mawl",
            "mawl-",
            "9lives",
            "rose pine",
            "rose_pine",
            "mawl\"",
            "\u{e9}t\u{e9}",
            "a".repeat(33).as_str(),
        ] {
            let stored = serde_json::json!({ "palette": bad }).to_string();
            assert_eq!(
                parse_eval_result(&answer(&stored)).unwrap().palette,
                None,
                "{bad}"
            );
        }
        for good in [
            "mawl",
            "rose-pine",
            "catppuccin",
            "a",
            "a".repeat(32).as_str(),
        ] {
            let stored = serde_json::json!({ "palette": good }).to_string();
            assert_eq!(
                parse_eval_result(&answer(&stored))
                    .unwrap()
                    .palette
                    .as_deref(),
                Some(good)
            );
        }
    }

    #[test]
    fn a_file_from_before_palettes_loads_without_its_accent() {
        let stored = r##"{"theme":"dark","accent":"#f7c4a3","reduceMotion":true}"##;
        let look = parse_eval_result(&answer(stored)).unwrap();
        assert_eq!(look.theme, Theme::Dark);
        assert_eq!(look.palette, None);
        assert!(look.reduce_motion);
        assert!(!serde_json::to_string(&look).unwrap().contains("accent"));
    }

    #[test]
    fn rgb_reads_the_checked_hex() {
        assert_eq!(rgb("#0B1019"), Some((0x0b, 0x10, 0x19)));
        assert_eq!(rgb("#FFFFFF"), Some((255, 255, 255)));
        assert_eq!(rgb("0B1019"), None);
        assert_eq!(rgb("#0B10"), None);
    }

    #[test]
    fn saves_and_loads_and_checks_the_file_again() {
        let dir = std::env::temp_dir().join(format!("mawl-appearance-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(load(&dir), None);
        let look = Appearance {
            theme: Theme::Light,
            palette: Some("gruvbox".into()),
            bg: Some("#FBF1C7".into()),
            reduce_motion: false,
        };
        save(&dir, &look).unwrap();
        assert_eq!(load(&dir), Some(look));
        // A hand-edited file goes through the same checks.
        fs::write(
            dir.join(APPEARANCE_FILE),
            r#"{"theme":"dark","palette":"url(evil)","bg":"url(evil)","reduceMotion":true}"#,
        )
        .unwrap();
        assert_eq!(
            load(&dir),
            Some(Appearance {
                theme: Theme::Dark,
                palette: None,
                bg: None,
                reduce_motion: true,
            })
        );
        fs::write(dir.join(APPEARANCE_FILE), "garbage").unwrap();
        assert_eq!(load(&dir), None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn the_script_reads_the_web_apps_key_and_the_background_and_cannot_throw() {
        assert!(READ_SCRIPT.contains(&format!("getItem(\"{STORAGE_KEY}\")")));
        assert!(READ_SCRIPT.contains("getPropertyValue(\"--bg\")"));
        assert_eq!(READ_SCRIPT.matches("catch").count(), 3);
    }
}
