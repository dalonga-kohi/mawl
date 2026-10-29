//! The custom title bar's window permissions for the app page.
//!
//! The window has no native title bar (`decorations: false`), so the app page draws one and needs
//! the window's drag, minimize, maximize and close. The app page is a remote origin to Tauri, which
//! the static capabilities never reach (see `acl.test.ts`). Its port is only known at run time, so
//! the host grants this narrow set for that exact origin just before it navigates there. Nothing
//! else of the window, and none of the host's own commands.
//!
//! Grants live for the process: Tauri cannot remove a run-time capability. After a server restart
//! on another port the old origin keeps this window-chrome grant, but the navigation rule only
//! lets the window load the current app origin, so no page of the old origin can use it.

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Url};

use crate::shell::MAIN_WINDOW;

/// Exactly what the title bar calls, nothing more (pinned by `acl.test.ts`).
const PERMISSIONS: [&str; 9] = [
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-is-maximized",
    "core:window:allow-is-focused",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
];

/// The origin to grant, as `scheme://host[:port]`, or `None` for an opaque one (nothing to grant).
fn grant_origin(url: &Url) -> Option<String> {
    let origin = url.origin();
    origin.is_tuple().then(|| origin.ascii_serialization())
}

/// Lets the page at `origin` control the main window's chrome. Safe to call again for the same
/// origin (the capability is replaced) and for a new one (a restarted server on another port).
pub fn allow_window_chrome(app: &AppHandle, url: &Url) {
    let Some(origin) = grant_origin(url) else {
        return;
    };
    let capability = PERMISSIONS.iter().fold(
        CapabilityBuilder::new(format!("titlebar-{origin}"))
            .local(false)
            .remote(format!("{origin}/*"))
            .window(MAIN_WINDOW),
        |builder, permission| builder.permission(*permission),
    );
    if let Err(e) = app.add_capability(capability) {
        eprintln!("mawl: could not allow the title bar for {origin}: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).expect("a test url parses")
    }

    #[test]
    fn grants_the_exact_origin_without_path_or_wildcard() {
        let origin = grant_origin(&url("http://127.0.0.1:7421/t/scout?thread=new")).unwrap();
        assert_eq!(origin, "http://127.0.0.1:7421");
        assert!(!origin.contains('*'));
    }

    #[test]
    fn grants_nothing_for_an_opaque_origin() {
        assert_eq!(grant_origin(&url("data:text/plain,hi")), None);
    }

    #[test]
    fn permissions_are_window_chrome_and_event_listening_only() {
        for permission in PERMISSIONS {
            assert!(
                permission.starts_with("core:window:allow-")
                    || permission == "core:event:allow-listen"
                    || permission == "core:event:allow-unlisten",
                "{permission}"
            );
        }
        assert!(!PERMISSIONS
            .iter()
            .any(|p| p.contains("navigate") || p.contains("webview")));
    }
}
