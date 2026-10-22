//! The Tauri side of the supervisor: the main window (splash first, then the app the server
//! serves), the launch token's initialization script, navigation rules, the splash's commands and
//! a clean "Quit Mawl". The decisions live in `mawl_host`; this file only wires them to Tauri.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use mawl_host::autostart::launched_hidden;
use mawl_host::driver::{HostUi, Supervisor, SupervisorConfig};
use mawl_host::launch::{self, Layout};
use mawl_host::machine::Status;
use mawl_host::markers::first_close_hint;
use mawl_host::notice::{Notice, NoticeTracker};
use mawl_host::port;
use mawl_host::presence::Presence;
use mawl_host::token::LaunchToken;
use mawl_host::webview::{allow_navigation, app_url, launch_token_script};
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;

pub const MAIN_WINDOW: &str = "main";
/// The splash listens for this event (`apps/web/src/splash/bridge.ts`).
pub const STATUS_EVENT: &str = "mawl://supervisor";
const SPLASH_PAGE: &str = "splash.html";
/// Vite proxies `/rpc` and `/ws` here in development (`MAWL_DEV_SERVER` default).
const DEV_SERVER_PORT: u16 = 7420;
/// If the splash never asks to enter the app (a script error), the host does it after this.
const ENTER_FALLBACK: Duration = Duration::from_secs(3);
/// If the splash never reports its first paint, the window shows anyway.
const SHOW_FALLBACK: Duration = Duration::from_secs(2);
/// After "Quit Mawl", the longest the host waits for the supervisor: its own grace is 30 s.
const QUIT_BACKSTOP: Duration = Duration::from_secs(45);

/// Shared by the commands, the tray and the run loop.
pub struct Shell {
    pub supervisor: Supervisor,
    splash: Url,
    dev_app: Option<Url>,
    /// Whether the window shows the app, decided together with the server being ready, so a crash
    /// can never leave it on a dead port (see `mawl_host::presence`).
    presence: Arc<Presence>,
    quitting: AtomicBool,
    /// The window was shown once at launch (set from the start for a login launch, which stays in
    /// the tray until the owner opens it). Later splash loads (a restart while Mawl sits in the
    /// tray) must not pop it up again.
    shown: AtomicBool,
    /// The close-to-tray hint was handled in this run, whatever the marker file says.
    close_hinted: AtomicBool,
    /// The supervisor finished: the app may exit now.
    stopped: Arc<AtomicBool>,
}

impl Shell {
    /// Where the app lives right now: Vite in development, else the server's loopback origin.
    pub fn app_url(&self) -> Url {
        self.dev_app
            .clone()
            .unwrap_or_else(|| app_url(self.supervisor.port()))
    }

    pub fn may_exit(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }
}

struct TauriUi {
    app: AppHandle,
    presence: Arc<Presence>,
    stopped: Arc<AtomicBool>,
    notices: Mutex<NoticeTracker>,
    clock: Instant,
}

impl HostUi for TauriUi {
    fn status(&self, status: Status) {
        self.presence.note_status(status);
        crate::tray::update(&self.app, status);
        self.notify_about(status);
        let _ = self.app.emit_to(MAIN_WINDOW, STATUS_EVENT, status);
        if status == Status::Ready {
            let app = self.app.clone();
            thread::spawn(move || {
                thread::sleep(ENTER_FALLBACK);
                if let Some(shell) = app.try_state::<Shell>() {
                    enter_app_now(&app, &shell);
                }
            });
        }
    }

    fn leave_app(&self) {
        if let Some(shell) = self.app.try_state::<Shell>() {
            shell.presence.leave(|| {
                if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.navigate(shell.splash.clone());
                }
            });
        }
    }

    fn exit(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.app.exit(0);
    }
}

impl TauriUi {
    /// A native notification for the status change, when the owner needs one (mawl_host::notice).
    fn notify_about(&self, status: Status) {
        let notice = {
            let now_ms = u64::try_from(self.clock.elapsed().as_millis()).unwrap_or(u64::MAX);
            let visible = window_visible(&self.app);
            let mut tracker = self.notices.lock().unwrap_or_else(|e| e.into_inner());
            tracker.on_status(status, now_ms, visible)
        };
        if let Some(notice) = notice {
            notify(&self.app, notice);
        }
    }
}

/// Shown and not minimized.
fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

fn notify(app: &AppHandle, notice: Notice) {
    if let Err(e) = app
        .notification()
        .builder()
        .title(notice.title)
        .body(notice.body)
        .show()
    {
        eprintln!("mawl: could not show a notification: {e}");
    }
}

/// The first time the window closes to the tray, say that Mawl keeps running. Never blocks the
/// close: a failed write or notification is only logged.
pub fn hint_first_close(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    if shell.close_hinted.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(data_dir) = app.path().app_local_data_dir() else {
        return;
    };
    if first_close_hint(&data_dir) {
        notify(
            app,
            Notice {
                title: "Mawl is still running",
                body: "Your teammates keep working. Open Mawl from the tray icon, or choose Quit Mawl to stop everything.",
            },
        );
    }
}

/// Navigates to the app only if the server is ready at this instant; the check and the navigation
/// happen under one lock, so leave_app cannot slip in between.
fn enter_app_now(app: &AppHandle, shell: &Shell) {
    shell.presence.try_enter(|| {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
            let _ = window.navigate(shell.app_url());
        }
    });
}

/// `http://tauri.localhost/` on Windows, `tauri://localhost/` elsewhere; the dev server in dev.
fn splash_url(app: &AppHandle) -> Url {
    if tauri::is_dev() {
        if let Some(dev) = app.config().build.dev_url.clone() {
            return dev.join(SPLASH_PAGE).unwrap_or(dev);
        }
    }
    let base = if cfg!(windows) {
        "http://tauri.localhost/"
    } else {
        "tauri://localhost/"
    };
    Url::parse(base)
        .and_then(|u| u.join(SPLASH_PAGE))
        .expect("a fixed url parses")
}

fn repo_root() -> Option<PathBuf> {
    if !tauri::is_dev() {
        return None;
    }
    // apps/desktop/src-tauri -> the repository root.
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .map(Path::to_path_buf)
}

/// Starts the supervisor and builds the main window on the splash. Called from `setup`.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_local_data_dir()?;
    let resource_dir = app.path().resource_dir()?;
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .unwrap_or_else(|| resource_dir.clone());
    let path_env = std::env::var("PATH").ok();
    let repo = repo_root();
    let command = launch::resolve(
        &Layout {
            exe_dir: &exe_dir,
            resource_dir: &resource_dir,
            repo_root: repo.as_deref(),
            path_env: path_env.as_deref(),
        },
        Path::exists,
    );
    let dev = tauri::is_dev();
    let port = if dev {
        DEV_SERVER_PORT
    } else {
        let chosen = port::choose_port(port::read_remembered(&data_dir), port::is_free)
            .unwrap_or(port::DEFAULT_PORT);
        let _ = port::remember(&data_dir, chosen);
        chosen
    };
    let token = LaunchToken::generate()
        .map_err(|e| tauri::Error::Io(std::io::Error::other(format!("no OS randomness: {e}"))))?;
    let dev_app = if dev {
        app.config().build.dev_url.clone()
    } else {
        None
    };
    let token_page = dev_app.clone().unwrap_or_else(|| app_url(port));
    let init_script = launch_token_script(token.expose(), &token_page);

    let start_hidden = launched_hidden(&std::env::args().collect::<Vec<_>>());
    let stopped = Arc::new(AtomicBool::new(false));
    let presence = Arc::new(Presence::new());
    let supervisor = Supervisor::start(
        SupervisorConfig {
            command,
            data_dir,
            host_env: std::env::vars().collect(),
            port,
            fixed_port: dev,
            token,
        },
        TauriUi {
            app: app.clone(),
            presence: Arc::clone(&presence),
            stopped: Arc::clone(&stopped),
            notices: Mutex::new(NoticeTracker::new(Status::Starting {
                stage: mawl_host::machine::Stage::Database,
            })),
            clock: Instant::now(),
        },
    );
    let splash = splash_url(app);
    let nav_presence = Arc::clone(&presence);
    app.manage(Shell {
        supervisor: supervisor.clone(),
        splash: splash.clone(),
        dev_app: dev_app.clone(),
        presence,
        quitting: AtomicBool::new(false),
        shown: AtomicBool::new(start_hidden),
        close_hinted: AtomicBool::new(false),
        stopped,
    });

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == MAIN_WINDOW)
        .cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    let nav_splash = splash.clone();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(init_script)
        // No pop-ups: window.open and target=_blank would start a webview that the navigation rule
        // does not guard. External links open nowhere until D1.5b sends them to the browser.
        .on_new_window(|_url, _features| NewWindowResponse::Deny)
        .on_navigation(move |target| {
            let current = dev_app
                .clone()
                .unwrap_or_else(|| app_url(supervisor.port()));
            // The app origin (which receives the launch token) loads only while the server is
            // ready: during a restart another local process could hold the freed port.
            let app_origin = nav_presence.app_allowed().then_some(&current);
            allow_navigation(target, &nav_splash, app_origin)
        })
        .build()?;
    if window.url().ok().as_ref() != Some(&splash) {
        eprintln!("mawl: the splash loaded from an unexpected url");
    }

    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(SHOW_FALLBACK);
        if let Some(shell) = handle.try_state::<Shell>() {
            show_once(&handle, &shell);
        }
    });
    Ok(())
}

/// "Quit Mawl" and any exit request: stop the server cleanly first.
pub fn begin_quit(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else {
        app.exit(0);
        return;
    };
    if shell.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    shell.supervisor.stop();
    // A backstop in case the supervisor thread is gone: exiting closes the job handles, which
    // ends the server tree anyway.
    let stopped = Arc::clone(&shell.stopped);
    let handle = app.clone();
    thread::spawn(move || {
        thread::sleep(QUIT_BACKSTOP);
        stopped.store(true, Ordering::SeqCst);
        handle.exit(0);
    });
}

fn diagnostics_header(app: &AppHandle) -> Vec<String> {
    vec![
        format!("Mawl desktop {}", app.package_info().version),
        format!("OS: {} {}", std::env::consts::OS, std::env::consts::ARCH),
    ]
}

#[tauri::command]
pub fn supervisor_status(shell: tauri::State<'_, Shell>) -> Status {
    shell.supervisor.status()
}

#[tauri::command]
pub fn copy_diagnostics(app: AppHandle, shell: tauri::State<'_, Shell>) -> String {
    shell.supervisor.diagnostics(&diagnostics_header(&app))
}

#[tauri::command]
pub fn retry_server(shell: tauri::State<'_, Shell>) {
    shell.supervisor.retry();
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    begin_quit(&app);
}

#[tauri::command]
pub fn enter_app(app: AppHandle, shell: tauri::State<'_, Shell>) {
    enter_app_now(&app, &shell);
}

#[tauri::command]
pub fn splash_shown(app: AppHandle, shell: tauri::State<'_, Shell>) {
    show_once(&app, &shell);
}

fn show_once(app: &AppHandle, shell: &Shell) {
    if shell.shown.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
