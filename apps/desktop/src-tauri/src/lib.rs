mod shell;

use std::sync::Mutex;

use mawl_host::deep_link;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, WindowEvent,
};
use tauri_plugin_deep_link::DeepLinkExt;

use shell::MAIN_WINDOW;

/// The web app listens for this event and routes to the path in the payload.
const NAVIGATE_EVENT: &str = "mawl://navigate";

/// The in-app path of a link that launched the app. The window cannot listen yet at that point,
/// so the web app asks for it once after it has registered its listener.
#[derive(Default)]
struct PendingNavigation(Mutex<Option<String>>);

#[tauri::command]
fn take_pending_navigation(state: tauri::State<PendingNavigation>) -> Option<String> {
    state.0.lock().ok()?.take()
}

/// Brings the main window forward from anywhere: minimized, hidden in the tray, or behind others.
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Deep links are untrusted: only an allowlisted path reaches the web app, and the window is
/// not raised for anything else.
fn open_deep_link(app: &AppHandle, url: &str) {
    if let Some(path) = deep_link::parse_deep_link(url) {
        show_main_window(app);
        let _ = app.emit_to(MAIN_WINDOW, NAVIGATE_EVENT, path);
    }
}

pub fn run() {
    let app = tauri::Builder::default()
        // Registered first, as the single-instance docs require. A second launch focuses the
        // running window (splash or app, also when hidden in the tray). With the `deep-link`
        // feature the plugin forwards a `mawl://` argument of the second launch to `on_open_url`.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(PendingNavigation::default())
        .invoke_handler(tauri::generate_handler![
            take_pending_navigation,
            shell::supervisor_status,
            shell::copy_diagnostics,
            shell::retry_server,
            shell::quit_app,
            shell::enter_app,
            shell::splash_shown,
        ])
        .setup(|app| {
            // Registers the scheme at runtime, so links work from `tauri dev` without an installer.
            #[cfg(any(windows, target_os = "linux"))]
            app.deep_link().register_all()?;

            if let Some(urls) = app.deep_link().get_current()? {
                let launch_path = urls
                    .iter()
                    .find_map(|u| deep_link::parse_deep_link(u.as_str()));
                if let (Some(path), Ok(mut slot)) =
                    (launch_path, app.state::<PendingNavigation>().0.lock())
                {
                    *slot = Some(path);
                }
            }

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    open_deep_link(&handle, url.as_str());
                }
            });

            // The server first, then the window on the splash (it needs the token and port).
            shell::start(app.handle())?;

            let open = MenuItemBuilder::with_id("open", "Open Mawl").build(app)?;
            let quit = MenuItemBuilder::with_id("quit", "Quit Mawl").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;

            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Mawl")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => show_main_window(app),
                    "quit" => shell::begin_quit(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            Ok(())
        })
        // Closing the window hides it to the tray: agents keep running on the server.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Mawl");

    app.run(|app, event| {
        // Every exit goes through a clean server stop first; the supervisor exits the app when
        // the server and its Postgres are gone (or after the kill deadline).
        if let RunEvent::ExitRequested { api, .. } = event {
            let ready_to_exit = app
                .try_state::<shell::Shell>()
                .is_none_or(|shell| shell.may_exit());
            if !ready_to_exit {
                api.prevent_exit();
                shell::begin_quit(app);
            }
        }
    });
}
