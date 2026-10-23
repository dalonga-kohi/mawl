//! The tray icon: its icon and tooltip follow the supervisor (or the remote Mawl's last check), and
//! its menu holds the status line, "Open Mawl", "Connect to a remote Mawl…", the "Start Mawl at
//! login" switch and "Quit Mawl". What each status says lives in `mawl_host::tray`; this file only
//! applies it.

use mawl_host::machine::Status;
use mawl_host::remote::RemoteHealth;
use mawl_host::tray::{
    dot_color, paint_status_dot, remote_presentation, tray_presentation, TrayPresentation,
};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_autostart::ManagerExt;

use crate::shell;

const TRAY_ID: &str = "main";
const OPEN_ID: &str = "open";
const QUIT_ID: &str = "quit";
const AUTOSTART_ID: &str = "autostart";
const STATUS_ID: &str = "status";
/// "Connect to a remote Mawl…", or "Change remote Mawl…" while the window shows one. Both open
/// the splash's form, which also holds "Use this PC's Mawl".
const TARGET_ID: &str = "target";

/// The menu items that change while the app runs.
struct TrayItems {
    status: MenuItem<tauri::Wry>,
    autostart: CheckMenuItem<tauri::Wry>,
    target: MenuItem<tauri::Wry>,
}

/// What the OS says about the login item. Dev builds never register one (it would point at a
/// debug executable), so they report off.
fn autostart_enabled(app: &AppHandle) -> bool {
    !tauri::is_dev() && app.autolaunch().is_enabled().unwrap_or(false)
}

pub fn build(app: &AppHandle, show_window: fn(&AppHandle)) -> tauri::Result<()> {
    let initial = tray_presentation(Status::Starting {
        stage: mawl_host::machine::Stage::Database,
    });
    let status = MenuItemBuilder::with_id(STATUS_ID, initial.tooltip)
        .enabled(false)
        .build(app)?;
    let open = MenuItemBuilder::with_id(OPEN_ID, "Open Mawl").build(app)?;
    let target = MenuItemBuilder::with_id(TARGET_ID, "Connect to a remote Mawl…").build(app)?;
    let autostart = CheckMenuItemBuilder::with_id(AUTOSTART_ID, "Start Mawl at login")
        .checked(autostart_enabled(app))
        .enabled(!tauri::is_dev())
        .build(app)?;
    let quit = MenuItemBuilder::with_id(QUIT_ID, "Quit Mawl").build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&status)
        .separator()
        .item(&open)
        .item(&target)
        .item(&autostart)
        .separator()
        .item(&quit)
        .build()?;
    app.manage(TrayItems {
        status,
        autostart,
        target,
    });

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip(initial.tooltip)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            OPEN_ID => show_window(app),
            TARGET_ID => {
                // The splash's form: it holds "Connect" and, for a remote, "Use this PC's Mawl".
                show_window(app);
                shell::show_connect(app);
            }
            QUIT_ID => shell::begin_quit(app),
            AUTOSTART_ID => toggle_autostart(app),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });
    if let Some(icon) = icon_for(app, initial.variant) {
        tray = tray.icon(icon);
    }
    tray.build(app)?;
    Ok(())
}

/// Applies a supervisor status to the tooltip, the icon and the status line.
pub fn update(app: &AppHandle, status: Status) {
    apply(app, tray_presentation(status));
}

/// Applies the last check of a remote Mawl (`None` before the first one).
pub fn update_remote(app: &AppHandle, health: Option<RemoteHealth>) {
    apply(app, remote_presentation(health));
}

/// The window shows a remote Mawl: say so in the menu.
pub fn show_remote_target(app: &AppHandle) {
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.target.set_text("Change remote Mawl…");
    }
    update_remote(app, None);
}

fn apply(app: &AppHandle, presentation: TrayPresentation) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_tooltip(Some(presentation.tooltip));
        if let Some(icon) = icon_for(app, presentation.variant) {
            let _ = tray.set_icon(Some(icon));
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.status.set_text(presentation.tooltip);
    }
}

fn icon_for(app: &AppHandle, variant: mawl_host::tray::TrayVariant) -> Option<Image<'static>> {
    let base = app.default_window_icon()?;
    let mut rgba = base.rgba().to_vec();
    if let Some(color) = dot_color(variant) {
        paint_status_dot(&mut rgba, base.width(), base.height(), color);
    }
    Some(Image::new_owned(rgba, base.width(), base.height()))
}

/// The check item flips itself on click; the OS decides what is true afterwards.
fn toggle_autostart(app: &AppHandle) {
    if !tauri::is_dev() {
        let launcher = app.autolaunch();
        let result = if launcher.is_enabled().unwrap_or(false) {
            launcher.disable()
        } else {
            launcher.enable()
        };
        if let Err(e) = result {
            eprintln!("mawl: could not change start at login: {e}");
        }
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.autostart.set_checked(autostart_enabled(app));
    }
}

/// First run only: switch "start at login" on. Never in a development build, and never again once
/// the owner has had the choice.
pub fn enable_autostart_first_run(app: &AppHandle, data_dir: &std::path::Path) {
    if tauri::is_dev() || !mawl_host::autostart::enable_by_default(data_dir) {
        return;
    }
    if let Err(e) = app.autolaunch().enable() {
        eprintln!("mawl: could not turn on start at login: {e}");
        // The default did not happen, so the next run tries again.
        mawl_host::autostart::retry_default_next_run(data_dir);
    }
    if let Some(items) = app.try_state::<TrayItems>() {
        let _ = items.autostart.set_checked(autostart_enabled(app));
    }
}
