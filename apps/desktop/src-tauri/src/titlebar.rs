//! The custom title bar's window permissions for the app page.
//!
//! The window has no native title bar (`decorations: false`), so the app page draws one and needs
//! the window's drag, minimize, maximize and close. The app page is a remote origin to Tauri, which
//! the static capabilities never reach (see `acl.test.ts`). Its port is only known at run time, so
//! the host grants this narrow set for that exact origin just before it navigates there. Nothing
//! else of the window, and none of the host's own commands.

use tauri::ipc::CapabilityBuilder;
use tauri::{AppHandle, Manager, Url};

use crate::shell::MAIN_WINDOW;

/// Lets the page at `origin` control the main window's chrome. Safe to call again for the same
/// origin (the capability is replaced) and for a new one (a restarted server on another port).
pub fn allow_window_chrome(app: &AppHandle, origin: &Url) {
    let origin = origin.origin().ascii_serialization();
    // An opaque origin serializes to "null": there is nothing to grant.
    if origin == "null" {
        return;
    }
    let capability = CapabilityBuilder::new(format!("titlebar-{origin}"))
        .local(false)
        .remote(format!("{origin}/*"))
        .window(MAIN_WINDOW)
        .permission("core:window:allow-minimize")
        .permission("core:window:allow-toggle-maximize")
        .permission("core:window:allow-internal-toggle-maximize")
        .permission("core:window:allow-close")
        .permission("core:window:allow-start-dragging")
        .permission("core:window:allow-is-maximized")
        .permission("core:window:allow-is-focused")
        .permission("core:event:allow-listen")
        .permission("core:event:allow-unlisten");
    if let Err(e) = app.add_capability(capability) {
        eprintln!("mawl: could not allow the title bar for {origin}: {e}");
    }
}
