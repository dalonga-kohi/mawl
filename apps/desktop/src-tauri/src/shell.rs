//! The Tauri side of the supervisor: the main window (splash first, then the app the server
//! serves, or a remote Mawl), the token's initialization script, navigation rules, the splash's
//! commands and a clean "Quit Mawl". The decisions live in `mawl_host`; this file only wires them
//! to Tauri.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use crate::titlebar;
use mawl_host::appearance::{self, Appearance};
use mawl_host::autostart::launched_hidden;
use mawl_host::deep_link::{link_target, PendingLink};
use mawl_host::driver::{HostUi, Supervisor, SupervisorConfig};
use mawl_host::external_link::{external_link, ExternalLink, OpenLimiter};
use mawl_host::launch::{self, Layout};
use mawl_host::machine::{Stage, Status};
use mawl_host::markers::{first_close_hint, release, FIRST_CLOSE_HINT_FILE};
use mawl_host::master_key::{system_store_named, wipe, KeyStore};
use mawl_host::notice::{Notice, NoticeTracker};
use mawl_host::port;
use mawl_host::presence::Presence;
use mawl_host::remote::{
    self, Recheck, RemoteHealth, RemoteToken, TokenError, UrlError, WindowTarget, RECHECK_EVERY,
    TOKEN_CREDENTIAL,
};
use mawl_host::token::LaunchToken;
use mawl_host::webview::{
    allow_navigation, app_url, launch_token_script, open_denied_externally, same_origin, TokenScope,
};
use serde::Serialize;
use tauri::webview::NewWindowResponse;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindowBuilder};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

pub const MAIN_WINDOW: &str = "main";
/// The splash listens for this event (`apps/web/src/splash/bridge.ts`).
pub const STATUS_EVENT: &str = "mawl://supervisor";
const SPLASH_PAGE: &str = "splash.html";
/// The splash opens on the "Connect to a remote Mawl" form with this query.
const CONNECT_QUERY: &str = "connect";
/// Vite proxies `/rpc` and `/ws` here in development (`MAWL_DEV_SERVER` default).
const DEV_SERVER_PORT: u16 = 7420;
/// If the splash never asks to enter the app (a script error), the host does it after this.
const ENTER_FALLBACK: Duration = Duration::from_secs(3);
/// If the splash never reports its first paint, the window shows anyway.
const SHOW_FALLBACK: Duration = Duration::from_secs(2);
/// After "Quit Mawl", the longest the host waits for the supervisor: its own grace is 30 s.
const QUIT_BACKSTOP: Duration = Duration::from_secs(45);
/// Lets the splash say "Restarting Mawl" before a relaunch starts.
const RELAUNCH_DELAY: Duration = Duration::from_millis(600);

/// A Mawl on another machine (`mawl_host::remote`): this PC runs no server.
pub struct RemoteLink {
    origin: Url,
    token: RemoteToken,
    /// The last check's answer, for diagnostics.
    last: Mutex<Option<RemoteHealth>>,
}

/// What the window shows: the server this PC runs, or a remote Mawl.
pub enum Backend {
    Local(Supervisor),
    Remote(RemoteLink),
}

/// Shared by the commands, the tray and the run loop.
pub struct Shell {
    backend: Backend,
    data_dir: PathBuf,
    splash: Url,
    dev_app: Option<Url>,
    /// Whether the window shows the app, decided together with the server being ready, so a crash
    /// can never leave it on a dead port (see `mawl_host::presence`).
    presence: Arc<Presence>,
    /// A deep link that arrived before the server was ready; the first entry into the app uses it.
    pending_link: Arc<PendingLink>,
    /// Where the remote Mawl's token lives (Windows Credential Manager, `Mawl/remote-token`).
    token_store: Arc<dyn KeyStore>,
    /// Held across a connect's check, token write and target write, and across a switch back to
    /// this PC, so two calls at once can never leave target A saved with token B.
    connecting: Mutex<()>,
    /// "Quit Mawl" or a session end began: the UI thread may be waiting on the supervisor (a
    /// Windows logoff), so the supervisor thread must not call into the window, tray or
    /// notifications any more.
    quitting: Arc<AtomicBool>,
    /// The server process is gone (set by `HostUi::server_gone`, before any UI call).
    server_gone: Arc<AtomicBool>,
    /// The window was shown once at launch (set from the start for a login launch, which stays in
    /// the tray until the owner opens it). Later splash loads (a restart while Mawl sits in the
    /// tray) must not pop it up again.
    shown: AtomicBool,
    /// The close-to-tray hint was handled in this run, whatever the marker file says.
    close_hinted: AtomicBool,
    /// The supervisor finished: the app may exit now.
    stopped: Arc<AtomicBool>,
    /// The window target changed: start Mawl again once this run has exited.
    relaunch: AtomicBool,
}

impl Shell {
    /// Where the app lives right now: a remote Mawl, Vite in development, else the server's
    /// loopback origin.
    pub fn app_url(&self) -> Url {
        match &self.backend {
            Backend::Remote(link) => link.origin.clone(),
            Backend::Local(supervisor) => self
                .dev_app
                .clone()
                .unwrap_or_else(|| app_url(supervisor.port())),
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self.backend, Backend::Remote(_))
    }

    /// The status for the tray at startup.
    pub fn status(&self) -> Status {
        match &self.backend {
            Backend::Local(supervisor) => supervisor.status(),
            Backend::Remote(_) => Status::Starting {
                stage: Stage::Server,
            },
        }
    }

    /// A wake from sleep: probe the local server now. A remote Mawl is re-checked on its own
    /// cadence (`watch_remote`).
    pub fn probe_now(&self) {
        if let Backend::Local(supervisor) = &self.backend {
            supervisor.probe_now();
        }
    }

    pub fn may_exit(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Whether the server and its Postgres have stopped. A logoff waits on this, not on
    /// `may_exit`: the exit goes through the UI thread, which is the one waiting.
    pub fn server_gone(&self) -> bool {
        self.server_gone.load(Ordering::SeqCst)
    }

    /// Whether this run should start Mawl again as it exits (the window target changed).
    pub fn relaunch_requested(&self) -> bool {
        self.relaunch.load(Ordering::SeqCst)
    }

    /// Where the window goes when it enters the app: a link that arrived early, else the root.
    fn entry_url(&self) -> Url {
        let base = self.app_url();
        self.pending_link
            .take()
            .and_then(|path| link_target(&base, &path))
            .unwrap_or(base)
    }

    /// Opens an allowlisted in-app path (from `deep_link::parse_deep_link`). The app page has no
    /// IPC, so the host navigates the window itself. With the server not ready the path is kept
    /// for the first entry into the app (the last link wins).
    pub fn open_link(&self, app: &AppHandle, path: &str) {
        let Some(target) = link_target(&self.app_url(), path) else {
            return;
        };
        self.presence.open_link(
            || {
                titlebar::allow_window_chrome(app, &target);
                navigate(app, target.clone());
            },
            || self.pending_link.set(path.to_owned()),
        );
    }

    fn splash_with(&self, query: Option<&str>) -> Url {
        let mut url = self.splash.clone();
        url.set_query(query);
        url
    }
}

/// Guards opening links in the browser: at most one per `external_link::MIN_GAP_MS`.
struct LinkGate {
    limiter: Mutex<OpenLimiter>,
    clock: Instant,
}

/// A navigation or pop-up the window refused. If it is an external web link that passes the
/// host's rule, the default browser opens it; nothing else happens for it.
fn open_externally(app: &AppHandle, gate: &LinkGate, target: &Url) {
    if external_link(target) != ExternalLink::Open {
        return;
    }
    let now_ms = u64::try_from(gate.clock.elapsed().as_millis()).unwrap_or(u64::MAX);
    let allowed = gate
        .limiter
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .allow(now_ms);
    if !allowed {
        return;
    }
    // Off the UI thread: the OS may take a moment to start the browser.
    let app = app.clone();
    let url = target.to_string();
    thread::spawn(move || {
        if let Err(e) = app.opener().open_url(url, None::<&str>) {
            eprintln!("mawl: could not open a link in the browser: {e}");
        }
    });
}

/// Reads the owner's theme and accent from the app page into `<data>/appearance.json`, for the
/// splash (`mawl_host::appearance`). Only when the window shows the app's origin; the answer is
/// checked field by field. Never blocks: the page answers later, or not at all.
fn pull_appearance(app: &AppHandle) {
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let on_app = window
        .url()
        .is_ok_and(|current| same_origin(&current, &shell.app_url()));
    if !on_app {
        return;
    }
    let data_dir = shell.data_dir.clone();
    let _ = window.eval_with_callback(appearance::READ_SCRIPT, move |answer| {
        if let Some(look) = appearance::parse_eval_result(&answer) {
            if let Err(e) = appearance::save(&data_dir, &look) {
                eprintln!("mawl: could not keep the appearance for the splash: {e}");
            }
        }
    });
}

struct TauriUi {
    app: AppHandle,
    presence: Arc<Presence>,
    stopped: Arc<AtomicBool>,
    quitting: Arc<AtomicBool>,
    server_gone: Arc<AtomicBool>,
    notices: Mutex<NoticeTracker>,
    clock: Instant,
}

impl HostUi for TauriUi {
    fn status(&self, status: Status) {
        self.presence.note_status(status);
        // From here on the UI thread may be blocked on us; window and tray calls would wait for it.
        if self.quitting.load(Ordering::SeqCst) {
            return;
        }
        crate::tray::update(&self.app, status);
        self.notify_about(status);
        let _ = self.app.emit_to(MAIN_WINDOW, STATUS_EVENT, status);
        if status == Status::Ready {
            schedule_enter_fallback(&self.app);
        }
    }

    fn leave_app(&self) {
        // Back to the splash: no app page is kept through a restart, because it would reconnect to
        // the old origin with the token before anything proved who answers there.
        if self.quitting.load(Ordering::SeqCst) {
            return;
        }
        if let Some(shell) = self.app.try_state::<Shell>() {
            // While the page is still there, so the splash shows the owner's theme.
            pull_appearance(&self.app);
            shell
                .presence
                .leave(|| navigate(&self.app, shell.splash.clone()));
        }
    }

    fn server_gone(&self) {
        self.server_gone.store(true, Ordering::SeqCst);
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
            let _ = notify(&self.app, notice);
        }
    }
}

fn navigate(app: &AppHandle, url: Url) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.navigate(url);
    }
}

/// If the splash never asks to enter (a script error), the host enters after `ENTER_FALLBACK`.
fn schedule_enter_fallback(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(ENTER_FALLBACK);
        if let Some(shell) = app.try_state::<Shell>() {
            enter_app_now(&app, &shell);
        }
    });
}

/// Shown and not minimized.
fn window_visible(app: &AppHandle) -> bool {
    app.get_webview_window(MAIN_WINDOW)
        .is_some_and(|w| w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(false))
}

/// Whether the notification was handed to the OS.
fn notify(app: &AppHandle, notice: Notice) -> bool {
    match app
        .notification()
        .builder()
        .title(notice.title)
        .body(notice.body)
        .show()
    {
        Ok(()) => true,
        Err(e) => {
            eprintln!("mawl: could not show a notification: {e}");
            false
        }
    }
}

/// The first time the window closes to the tray, say that Mawl keeps running. Never blocks the
/// close: a failed write or notification is only logged. Also keeps the owner's appearance for
/// the splash.
pub fn hint_first_close(app: &AppHandle) {
    pull_appearance(app);
    let Some(shell) = app.try_state::<Shell>() else {
        return;
    };
    if shell.close_hinted.swap(true, Ordering::SeqCst) {
        return;
    }
    let Ok(data_dir) = app.path().app_local_data_dir() else {
        return;
    };
    if first_close_hint(&data_dir)
        && !notify(
            app,
            Notice {
                title: "Mawl is still running",
                body: "Your teammates keep working. Open Mawl from the tray icon, or choose Quit Mawl to stop everything.",
            },
        )
    {
        // The owner never saw it: the next run shows it again (not twice in this one).
        release(&data_dir, FIRST_CLOSE_HINT_FILE);
    }
}

/// While the window shows a remote Mawl's app, checks it again every `RECHECK_EVERY` with the
/// origin-bound proof and sends the window back to the splash when the answer is no longer that
/// Mawl (`remote::Recheck`); the splash checks again before it enters. A remote Mawl has no
/// supervisor, so this is what stops its page from talking on to whoever answers that origin later.
fn watch_remote(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        let mut recheck = Recheck::default();
        loop {
            thread::sleep(RECHECK_EVERY);
            let Some(shell) = app.try_state::<Shell>() else {
                continue;
            };
            if shell.quitting.load(Ordering::SeqCst) {
                return;
            }
            let Backend::Remote(link) = &shell.backend else {
                return;
            };
            if !shell.presence.in_app() {
                recheck = Recheck::default();
                continue;
            }
            let health = remote::check(&link.origin, &link.token, remote::fetch_once);
            *link.last.lock().unwrap_or_else(|e| e.into_inner()) = Some(health);
            if shell.quitting.load(Ordering::SeqCst) {
                return;
            }
            let keep = recheck.keeps_app(health);
            shell
                .presence
                .recheck(keep, || navigate(&app, shell.splash.clone()));
            crate::tray::update_remote(&app, Some(health));
        }
    });
}

/// Navigates to the app only if the server is ready at this instant; the check and the navigation
/// happen under one lock, so leave_app cannot slip in between.
fn enter_app_now(app: &AppHandle, shell: &Shell) {
    shell.presence.try_enter(|| {
        let url = shell.entry_url();
        titlebar::allow_window_chrome(app, &url);
        navigate(app, url);
    });
}

/// "Connect to a remote Mawl…" from the tray: the splash's form, over the app. The server keeps
/// running; Cancel goes back in.
pub fn show_connect(app: &AppHandle) {
    pull_appearance(app);
    if let Some(shell) = app.try_state::<Shell>() {
        let url = shell.splash_with(Some(CONNECT_QUERY));
        shell.presence.show_splash(|| navigate(app, url));
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

/// The saved window target with its token, or `None` for the local server. A remote target
/// whose token is missing or unreadable falls back to the local server.
fn remote_target(data_dir: &Path, store: &dyn KeyStore) -> Option<(Url, RemoteToken)> {
    let WindowTarget::Remote { origin } = remote::load_target(data_dir) else {
        return None;
    };
    match remote::load_token(store) {
        Ok(Some(token)) => Some((origin, token)),
        Ok(None) => {
            eprintln!("mawl: no token for the remote Mawl is stored; using this PC's server");
            None
        }
        Err(e) => {
            eprintln!("mawl: could not read the remote Mawl's token ({e}); using this PC's server");
            None
        }
    }
}

struct Flags {
    stopped: Arc<AtomicBool>,
    quitting: Arc<AtomicBool>,
    server_gone: Arc<AtomicBool>,
}

/// Starts the local server and its supervisor.
fn start_local(
    app: &AppHandle,
    data_dir: &Path,
    presence: &Arc<Presence>,
    flags: &Flags,
) -> tauri::Result<(Supervisor, LaunchToken, u16)> {
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
        let chosen = port::choose_port(port::read_remembered(data_dir), port::is_free)
            .unwrap_or(port::DEFAULT_PORT);
        let _ = port::remember(data_dir, chosen);
        chosen
    };
    let token = LaunchToken::generate()
        .map_err(|e| tauri::Error::Io(std::io::Error::other(format!("no OS randomness: {e}"))))?;
    let supervisor = Supervisor::start(
        SupervisorConfig {
            command,
            data_dir: data_dir.to_path_buf(),
            host_env: std::env::vars().collect(),
            port,
            fixed_port: dev,
            token: token.clone(),
            // The master key lives in Windows Credential Manager (target `Mawl/master-key`).
            key_store: mawl_host::master_key::system_store(),
        },
        TauriUi {
            app: app.clone(),
            presence: Arc::clone(presence),
            stopped: Arc::clone(&flags.stopped),
            quitting: Arc::clone(&flags.quitting),
            server_gone: Arc::clone(&flags.server_gone),
            notices: Mutex::new(NoticeTracker::new(Status::Starting {
                stage: Stage::Database,
            })),
            clock: Instant::now(),
        },
    );
    Ok((supervisor, token, port))
}

/// Starts the supervisor (or, when the owner chose one, connects to a remote Mawl instead) and
/// builds the main window on the splash. Called from `setup`.
pub fn start(app: &AppHandle) -> tauri::Result<()> {
    let data_dir = app.path().app_local_data_dir()?;
    let token_store = system_store_named(TOKEN_CREDENTIAL);
    let dev = tauri::is_dev();
    let start_hidden = launched_hidden(&std::env::args().collect::<Vec<_>>());
    let flags = Flags {
        stopped: Arc::new(AtomicBool::new(false)),
        quitting: Arc::new(AtomicBool::new(false)),
        server_gone: Arc::new(AtomicBool::new(false)),
    };
    let presence = Arc::new(Presence::new());

    let (backend, init_script, dev_app) = match remote_target(&data_dir, token_store.as_ref()) {
        Some((origin, token)) => {
            // No local server: nothing to stop at quit, nothing to wait for at logoff.
            flags.server_gone.store(true, Ordering::SeqCst);
            let script = launch_token_script(token.expose(), &origin, TokenScope::Origin);
            let link = RemoteLink {
                origin,
                token,
                last: Mutex::new(None),
            };
            (Backend::Remote(link), script, None)
        }
        None => {
            let (supervisor, token, port) = start_local(app, &data_dir, &presence, &flags)?;
            let dev_app = if dev {
                app.config().build.dev_url.clone()
            } else {
                None
            };
            let token_page = dev_app.clone().unwrap_or_else(|| app_url(port));
            // The port may move within a run; the navigation rule pins the current one.
            let script =
                launch_token_script(token.expose(), &token_page, TokenScope::LoopbackAnyPort);
            (Backend::Local(supervisor), script, dev_app)
        }
    };

    let splash = splash_url(app);
    let nav_presence = Arc::clone(&presence);
    app.manage(Shell {
        backend,
        data_dir,
        splash: splash.clone(),
        dev_app,
        presence,
        pending_link: Arc::new(PendingLink::new()),
        token_store,
        connecting: Mutex::new(()),
        quitting: flags.quitting,
        server_gone: flags.server_gone,
        shown: AtomicBool::new(start_hidden),
        close_hinted: AtomicBool::new(false),
        stopped: flags.stopped,
        relaunch: AtomicBool::new(false),
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
    let gate = Arc::new(LinkGate {
        limiter: Mutex::new(OpenLimiter::new()),
        clock: Instant::now(),
    });
    let popup_app = app.clone();
    let popup_gate = Arc::clone(&gate);
    let nav_app = app.clone();
    let window = WebviewWindowBuilder::from_config(app, &config)?
        .initialization_script(init_script)
        // No pop-ups: window.open and target=_blank would start a webview that the navigation rule
        // does not guard. An external web link goes to the browser instead (`open_externally`).
        .on_new_window(move |url, _features| {
            open_externally(&popup_app, &popup_gate, &url);
            NewWindowResponse::Deny
        })
        .on_navigation(move |target| {
            let Some(shell) = nav_app.try_state::<Shell>() else {
                return false;
            };
            let current = shell.app_url();
            // The app origin (which receives the token) loads only while the supervisor is Ready
            // (during a restart another local process could hold the freed port) or, for a remote
            // Mawl, while its last check proved that a server holding the token answers for this
            // origin (`remote::check`, repeated by `watch_remote`).
            let app_origin = nav_presence.app_allowed().then_some(&current);
            let allowed = allow_navigation(target, &nav_splash, app_origin);
            // A refused load of the app's own origin stays refused: it is not a browser link.
            if !allowed && open_denied_externally(target, &current) {
                open_externally(&nav_app, &gate, target);
            }
            allowed
        })
        .build()?;
    // A logoff or shutdown must stop the server cleanly, and a wake from sleep probes it.
    #[cfg(windows)]
    if let Ok(hwnd) = window.hwnd() {
        crate::session_end::install(app, hwnd.0 as usize);
    }
    if window.url().ok().as_ref() != Some(&splash) {
        eprintln!("mawl: the splash loaded from an unexpected url");
    }

    if matches!(app.state::<Shell>().backend, Backend::Remote(_)) {
        watch_remote(app);
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
    if shell.quitting.load(Ordering::SeqCst) {
        return;
    }
    // While the page is still there: the splash shows the owner's theme next time.
    pull_appearance(app);
    if shell.quitting.swap(true, Ordering::SeqCst) {
        return;
    }
    let Backend::Local(supervisor) = &shell.backend else {
        // A remote Mawl: nothing runs here, so exit now.
        shell.stopped.store(true, Ordering::SeqCst);
        app.exit(0);
        return;
    };
    supervisor.stop();
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

/// The window target changed: stop this run cleanly and start Mawl again once it has exited
/// (`lib.rs` spawns the new process on `RunEvent::Exit`, after the single-instance plugin let go
/// of its lock). The short delay lets the splash say so first.
fn relaunch(app: &AppHandle) {
    let app = app.clone();
    thread::spawn(move || {
        thread::sleep(RELAUNCH_DELAY);
        if let Some(shell) = app.try_state::<Shell>() {
            shell.relaunch.store(true, Ordering::SeqCst);
        }
        begin_quit(&app);
    });
}

/// Starts a new Mawl process without arguments: a normal, visible launch. Called as this one
/// exits.
pub fn spawn_relaunch() {
    match std::env::current_exe() {
        Ok(exe) => {
            if let Err(e) = std::process::Command::new(exe).spawn() {
                eprintln!("mawl: could not start Mawl again: {e}");
            }
        }
        Err(e) => eprintln!("mawl: could not find Mawl to start it again: {e}"),
    }
}

fn diagnostics_header(app: &AppHandle) -> Vec<String> {
    vec![
        format!("Mawl desktop {}", app.package_info().version),
        format!("OS: {} {}", std::env::consts::OS, std::env::consts::ARCH),
    ]
}

/// What the splash needs to know about the target. Never the token.
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TargetView {
    Local,
    Remote { origin: String },
}

/// Why connecting to a remote Mawl did not happen. The splash words each one.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectError {
    Url {
        reason: UrlError,
    },
    Token {
        reason: TokenError,
    },
    Remote {
        health: RemoteHealth,
    },
    /// Windows Credential Manager or the data dir refused the write.
    Store,
}

#[tauri::command]
pub fn supervisor_status(shell: tauri::State<'_, Shell>) -> Status {
    shell.status()
}

#[tauri::command]
pub fn copy_diagnostics(app: AppHandle, shell: tauri::State<'_, Shell>) -> String {
    let header = diagnostics_header(&app);
    match &shell.backend {
        Backend::Local(supervisor) => supervisor.diagnostics(&header),
        Backend::Remote(link) => {
            let last = *link.last.lock().unwrap_or_else(|e| e.into_inner());
            let mut lines = header;
            lines.push(format!("Remote Mawl: {}", link.origin));
            lines.push(format!(
                "Last check: {}",
                last.map_or_else(
                    || "none yet".to_owned(),
                    |h| serde_json::to_string(&h).unwrap_or_default()
                )
            ));
            lines.join("\n")
        }
    }
}

#[tauri::command]
pub fn retry_server(shell: tauri::State<'_, Shell>) {
    if let Backend::Local(supervisor) = &shell.backend {
        supervisor.retry();
    }
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

#[tauri::command]
pub fn host_target(shell: tauri::State<'_, Shell>) -> TargetView {
    match &shell.backend {
        Backend::Local(_) => TargetView::Local,
        Backend::Remote(link) => TargetView::Remote {
            origin: link.origin.to_string(),
        },
    }
}

/// The owner's theme and accent as last read from the app page, for the splash.
#[tauri::command]
pub fn splash_appearance(shell: tauri::State<'_, Shell>) -> Option<Appearance> {
    appearance::load(&shell.data_dir)
}

/// Checks the remote Mawl (remote mode only). Ready opens the app origin to the window; the
/// splash then enters (a fallback enters anyway).
#[tauri::command(async)]
pub fn check_remote(app: AppHandle) -> RemoteHealth {
    let Some(shell) = app.try_state::<Shell>() else {
        return RemoteHealth::Unreachable;
    };
    let Backend::Remote(link) = &shell.backend else {
        return RemoteHealth::NotMawl;
    };
    let health = remote::check(&link.origin, &link.token, remote::fetch_once);
    *link.last.lock().unwrap_or_else(|e| e.into_inner()) = Some(health);
    shell.presence.set_ready(health == RemoteHealth::Ready);
    crate::tray::update_remote(&app, Some(health));
    if health == RemoteHealth::Ready {
        schedule_enter_fallback(&app);
    }
    health
}

/// "Connect": checks the address and the token, asks the remote for the origin-bound proof that a
/// server holding the token answers there, keeps the token in Credential Manager and the address
/// in the data dir, then starts Mawl again on the remote. Nothing is saved unless the remote proved
/// itself. The check and both writes run under one lock, so parallel calls cannot mix them. The
/// token never reaches a log line, a URL or the diagnostics.
#[tauri::command(async)]
pub fn connect_remote(app: AppHandle, url: String, token: String) -> Result<(), ConnectError> {
    let mut raw = token;
    let parsed = remote::parse_remote_token(&raw);
    // SAFETY: zero bytes are valid UTF-8; the String is dropped right after.
    wipe(unsafe { raw.as_bytes_mut() });
    drop(raw);
    let origin = remote::parse_remote_url(&url).map_err(|reason| ConnectError::Url { reason })?;
    let token = parsed.map_err(|reason| ConnectError::Token { reason })?;
    let shell = app.try_state::<Shell>().ok_or(ConnectError::Store)?;
    let _connecting = shell.connecting.lock().unwrap_or_else(|e| e.into_inner());
    let health = remote::check(&origin, &token, remote::fetch_once);
    if health != RemoteHealth::Ready {
        return Err(ConnectError::Remote { health });
    }
    remote::store_token(shell.token_store.as_ref(), &token).map_err(|e| {
        eprintln!("mawl: could not keep the remote Mawl's token: {e}");
        ConnectError::Store
    })?;
    if let Err(e) = remote::save_target(&shell.data_dir, &WindowTarget::Remote { origin }) {
        eprintln!("mawl: could not save the remote Mawl's address: {e}");
        let _ = remote::forget_token(shell.token_store.as_ref());
        return Err(ConnectError::Store);
    }
    relaunch(&app);
    Ok(())
}

/// "Use this PC's Mawl": forgets the remote's address and token and starts Mawl again on the
/// server this PC runs.
#[tauri::command]
pub fn use_local_mawl(app: AppHandle) -> Result<(), ConnectError> {
    let shell = app.try_state::<Shell>().ok_or(ConnectError::Store)?;
    let _connecting = shell.connecting.lock().unwrap_or_else(|e| e.into_inner());
    remote::save_target(&shell.data_dir, &WindowTarget::Local).map_err(|e| {
        eprintln!("mawl: could not switch back to this PC's server: {e}");
        ConnectError::Store
    })?;
    if let Err(e) = remote::forget_token(shell.token_store.as_ref()) {
        // The target is local already, so the token is never used again; say so and go on.
        eprintln!("mawl: could not delete the remote Mawl's token: {e}");
    }
    relaunch(&app);
    Ok(())
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
