//! The Tauri side of the supervisor: the main window (splash first, then the app the server
//! serves), the launch token's initialization script, navigation rules, the splash's commands and
//! a clean "Quit Mawl". The decisions live in `mawl_host`; this file only wires them to Tauri.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use mawl_host::driver::{HostUi, Supervisor, SupervisorConfig};
use mawl_host::launch::{self, Layout};
use mawl_host::machine::Status;
use mawl_host::port;
use mawl_host::token::LaunchToken;
use mawl_host::webview::{allow_navigation, app_url, launch_token_script};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindowBuilder};

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
    /// The main window shows the app (not the splash).
    in_app: AtomicBool,
    quitting: AtomicBool,
    /// The window was shown once at launch. Later splash loads (a restart while Mawl sits in the
    /// tray) must not pop it up again.
    shown: AtomicBool,
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
    stopped: Arc<AtomicBool>,
}

impl HostUi for TauriUi {
    fn status(&self, status: Status) {
        let _ = self.app.emit_to(MAIN_WINDOW, STATUS_EVENT, status);
        if status == Status::Ready {
            let app = self.app.clone();
            thread::spawn(move || {
                thread::sleep(ENTER_FALLBACK);
                if let Some(shell) = app.try_state::<Shell>() {
                    if shell.supervisor.status() == Status::Ready {
                        enter_app_now(&app, &shell);
                    }
                }
            });
        }
    }

    fn leave_app(&self) {
        if let Some(shell) = self.app.try_state::<Shell>() {
            if shell.in_app.swap(false, Ordering::SeqCst) {
                if let Some(window) = self.app.get_webview_window(MAIN_WINDOW) {
                    let _ = window.navigate(shell.splash.clone());
                }
            }
        }
    }

    fn exit(&self) {
        self.stopped.store(true, Ordering::SeqCst);
        self.app.exit(0);
    }
}

fn enter_app_now(app: &AppHandle, shell: &Shell) {
    if shell.in_app.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.navigate(shell.app_url());
    }
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

    let stopped = Arc::new(AtomicBool::new(false));
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
            stopped: Arc::clone(&stopped),
        },
    );
    let splash = splash_url(app);
    app.manage(Shell {
        supervisor: supervisor.clone(),
        splash: splash.clone(),
        dev_app: dev_app.clone(),
        in_app: AtomicBool::new(false),
        quitting: AtomicBool::new(false),
        shown: AtomicBool::new(false),
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
        .on_navigation(move |target| {
            let current = dev_app
                .clone()
                .unwrap_or_else(|| app_url(supervisor.port()));
            allow_navigation(target, &nav_splash, Some(&current))
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
    if shell.supervisor.status() == Status::Ready {
        enter_app_now(&app, &shell);
    }
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
