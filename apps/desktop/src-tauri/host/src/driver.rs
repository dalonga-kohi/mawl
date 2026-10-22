//! Runs the [`Machine`] on its own thread and carries out its effects: processes, timers,
//! probes, and calls into the window through [`HostUi`].

use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::env::{server_env, ServerEnv};
use crate::health::{probe, PROBE_TIMEOUT};
use crate::launch::{LaunchError, ServerCommand};
use crate::logs::{stage_hint, LogRing, Source};
use crate::machine::{Effect, Event, Gen, Health, Machine, Status, Timer};
use crate::port;
use crate::process::{read_lines, ServerProcess};
use crate::token::LaunchToken;

/// What the supervisor tells the window. Called from the supervisor thread.
pub trait HostUi: Send + Sync + 'static {
    fn status(&self, status: Status);
    /// The app page shows a server that is going away: show the splash.
    fn leave_app(&self);
    /// The server process (and its Postgres) is gone, for good: called once, before the final
    /// status and before `exit`. It must not touch the window, the tray or anything else that
    /// needs the UI thread, which may be blocked waiting for exactly this (a Windows logoff).
    fn server_gone(&self);
    /// Everything is stopped: exit the app.
    fn exit(&self);
}

pub struct SupervisorConfig {
    /// Where the server comes from; an error fails at once with "not installed".
    pub command: Result<ServerCommand, LaunchError>,
    pub data_dir: PathBuf,
    /// The host's environment; [`server_env`] picks from it.
    pub host_env: Vec<(String, String)>,
    pub port: u16,
    /// Development: Vite proxies to this exact port, so never move it.
    pub fixed_port: bool,
    pub token: LaunchToken,
}

enum Msg {
    Event(Event),
    Line(Gen, Source, String),
}

struct Shared {
    status: Mutex<Status>,
    ring: Mutex<LogRing>,
    port: AtomicU16,
}

/// A handle to the supervisor thread. Cheap to clone.
#[derive(Clone)]
pub struct Supervisor {
    tx: Sender<Msg>,
    shared: Arc<Shared>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Supervisor {
    pub fn start(config: SupervisorConfig, ui: impl HostUi) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let machine = Machine::new();
        let shared = Arc::new(Shared {
            status: Mutex::new(machine.status()),
            ring: Mutex::new(LogRing::new(config.token.clone())),
            port: AtomicU16::new(config.port),
        });
        let mut driver = Driver {
            machine,
            config,
            ui,
            shared: Arc::clone(&shared),
            tx: tx.clone(),
            started: Instant::now(),
            timers: Vec::new(),
            current: None,
            done: false,
            gone_reported: false,
        };
        thread::Builder::new()
            .name("mawl-supervisor".into())
            .spawn(move || {
                driver.apply(Event::Start);
                while !driver.done {
                    let wait = driver.next_wait();
                    match rx.recv_timeout(wait) {
                        Ok(Msg::Event(event)) => driver.apply(event),
                        Ok(Msg::Line(gen, source, line)) => driver.line(gen, source, &line),
                        Err(RecvTimeoutError::Timeout) => driver.fire_timers(),
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            })
            .expect("the supervisor thread starts");
        Self { tx, shared }
    }

    /// "Quit Mawl": stop the server cleanly, then [`HostUi::exit`].
    pub fn stop(&self) {
        let _ = self.tx.send(Msg::Event(Event::Stop));
    }

    /// The PC woke from sleep: check the server's health now. The state of the last probe and the
    /// sockets from before the sleep may be stale.
    pub fn probe_now(&self) {
        let _ = self.tx.send(Msg::Event(Event::ProbeNow));
    }

    /// "Try again" after the server failed for good.
    pub fn retry(&self) {
        let _ = self.tx.send(Msg::Event(Event::Retry));
    }

    pub fn status(&self) -> Status {
        *lock(&self.shared.status)
    }

    /// The port of the current (or next) server.
    pub fn port(&self) -> u16 {
        self.shared.port.load(Ordering::SeqCst)
    }

    /// The text for "Copy diagnostics". The token never appears in it.
    pub fn diagnostics(&self, header: &[String]) -> String {
        let mut lines = header.to_vec();
        lines.push(format!(
            "Status: {}",
            serde_json::to_string(&self.status()).unwrap_or_default()
        ));
        lines.push(format!("Port: {}", self.port()));
        lock(&self.shared.ring).diagnostics(&lines)
    }
}

/// Arms `timer` at `at`. An identical pending timer is replaced, so an extra probe (after a
/// wake from sleep) cannot leave two probe cadences running side by side.
fn arm(timers: &mut Vec<(Instant, Timer)>, at: Instant, timer: Timer) {
    timers.retain(|(_, pending)| *pending != timer);
    timers.push((at, timer));
}

/// The effects after which no server process is left to wait for: the final `Stopped` status
/// and the exit. Reported to the host before either runs.
fn marks_server_gone(effect: &Effect) -> bool {
    matches!(effect, Effect::Status(Status::Stopped) | Effect::Exit)
}

struct Driver<U: HostUi> {
    machine: Machine,
    config: SupervisorConfig,
    ui: U,
    shared: Arc<Shared>,
    tx: Sender<Msg>,
    started: Instant,
    timers: Vec<(Instant, Timer)>,
    current: Option<(Gen, ServerProcess)>,
    done: bool,
    gone_reported: bool,
}

impl<U: HostUi> Driver<U> {
    fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn note(&self, text: &str) {
        lock(&self.shared.ring).push(Source::Host, text);
    }

    fn next_wait(&self) -> Duration {
        let now = Instant::now();
        self.timers
            .iter()
            .map(|(at, _)| at.saturating_duration_since(now))
            .min()
            .unwrap_or(Duration::from_secs(3600))
    }

    fn fire_timers(&mut self) {
        let now = Instant::now();
        let (due, later): (Vec<_>, Vec<_>) = self.timers.drain(..).partition(|(at, _)| *at <= now);
        self.timers = later;
        for (_, timer) in due {
            self.apply(Event::Timer(timer));
        }
    }

    fn line(&mut self, gen: Gen, source: Source, line: &str) {
        lock(&self.shared.ring).push(source, line);
        if source == Source::Stdout {
            if let Some(stage) = stage_hint(line) {
                self.apply(Event::Progress(gen, stage));
            }
        }
    }

    fn apply(&mut self, event: Event) {
        let mut queue = vec![event];
        while let Some(event) = queue.pop() {
            match event {
                Event::Health(_, Health::Foreign) => {
                    let port = self.shared.port.load(Ordering::SeqCst);
                    self.note(&format!(
                        "another program answers on port {port} without Mawl's proof; not opening it"
                    ));
                }
                Event::Exited(gen, code) => {
                    if self.current.as_ref().is_some_and(|(g, _)| *g == gen) {
                        // Dropping the process ends its job: nothing it started outlives it.
                        self.current = None;
                        self.note(&match code {
                            Some(code) => format!("server exited with code {code}"),
                            None => "server ended without an exit code".into(),
                        });
                    }
                }
                Event::Health(_, health)
                    if health != Health::Ok && self.machine.status() == Status::Ready =>
                {
                    self.note(&format!("health check failed: {health:?}"));
                }
                _ => {}
            }
            let effects = self.machine.handle(event, self.now_ms());
            for effect in effects {
                if let Some(next) = self.run(effect) {
                    queue.push(next);
                }
            }
        }
    }

    /// Carries out one effect; returns a follow-up event when the effect failed at once.
    fn run(&mut self, effect: Effect) -> Option<Event> {
        if marks_server_gone(&effect) && !self.gone_reported {
            self.gone_reported = true;
            self.ui.server_gone();
        }
        match effect {
            Effect::Spawn(gen) => return self.spawn(gen),
            Effect::Probe(gen) => {
                let port = self.shared.port.load(Ordering::SeqCst);
                let tx = self.tx.clone();
                let token = self.config.token.clone();
                thread::spawn(move || {
                    let health = probe(port, PROBE_TIMEOUT, &token);
                    let _ = tx.send(Msg::Event(Event::Health(gen, health)));
                });
            }
            Effect::CloseStdin(gen) => {
                if let Some((g, process)) = self.current.as_mut() {
                    if *g == gen {
                        process.close_stdin();
                        self.note("asked the server to stop");
                    }
                }
            }
            Effect::Kill(gen) => {
                if let Some((g, process)) = self.current.as_ref() {
                    if *g == gen {
                        self.note("ending the server process tree");
                        process.kill();
                    }
                }
            }
            Effect::SetTimer { timer, after_ms } => arm(
                &mut self.timers,
                Instant::now() + Duration::from_millis(after_ms),
                timer,
            ),
            Effect::Status(status) => {
                *lock(&self.shared.status) = status;
                if let Status::Restarting {
                    attempt,
                    retry_in_ms: Some(ms),
                    ..
                } = status
                {
                    self.note(&format!("restart {attempt} in {ms} ms"));
                }
                self.ui.status(status);
            }
            Effect::LeaveApp => self.ui.leave_app(),
            Effect::Exit => {
                self.done = true;
                self.ui.exit();
            }
        }
        None
    }

    fn spawn(&mut self, gen: Gen) -> Option<Event> {
        let command = match &self.config.command {
            Ok(command) => command.clone(),
            Err(err) => {
                self.note(&format!("cannot start the server: {err}"));
                return Some(Event::LaunchFailed(gen));
            }
        };
        let mut port = self.shared.port.load(Ordering::SeqCst);
        if !self.config.fixed_port && !port::is_free(port) {
            match port::choose_port(None, port::is_free) {
                Ok(next) => {
                    self.note(&format!("port {port} is taken, moving to {next}"));
                    port = next;
                    self.shared.port.store(port, Ordering::SeqCst);
                    if let Err(err) = port::remember(&self.config.data_dir, port) {
                        self.note(&format!("could not remember the port: {err}"));
                    }
                }
                Err(err) => self.note(&format!("no free port: {err}")),
            }
        }
        let env = server_env(
            self.config.host_env.iter().cloned(),
            &ServerEnv {
                data_dir: &self.config.data_dir,
                pg_root: command.pg_root.as_deref(),
                web_dir: command.web_dir.as_deref(),
                port,
                dev: command.dev,
            },
        );
        if let Err(err) = std::fs::create_dir_all(&self.config.data_dir) {
            self.note(&format!("cannot create the data folder: {err}"));
        }
        match ServerProcess::spawn(&command, &env, &self.config.data_dir, &self.config.token) {
            Ok(mut process) => {
                self.note(&format!(
                    "server started (pid {}, port {port})",
                    process.pid()
                ));
                let (stdout, stderr) = process.take_output();
                if let Some(out) = stdout {
                    let tx = self.tx.clone();
                    read_lines(out, move |line| {
                        let _ = tx.send(Msg::Line(gen, Source::Stdout, line));
                    });
                }
                if let Some(err) = stderr {
                    let tx = self.tx.clone();
                    read_lines(err, move |line| {
                        let _ = tx.send(Msg::Line(gen, Source::Stderr, line));
                    });
                }
                let tx = self.tx.clone();
                process.watch_exit(move |code| {
                    let _ = tx.send(Msg::Event(Event::Exited(gen, code)));
                });
                self.current = Some((gen, process));
                None
            }
            Err(err) => {
                self.note(&format!("the server failed to start: {err}"));
                Some(Event::SpawnFailed(gen))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_final_stop_and_the_exit_mean_the_server_is_gone() {
        use crate::machine::{Failure, Stage};
        assert!(marks_server_gone(&Effect::Status(Status::Stopped)));
        assert!(marks_server_gone(&Effect::Exit));
        for status in [
            Status::Stopping,
            Status::Ready,
            Status::Starting {
                stage: Stage::Server,
            },
            Status::Failed {
                reason: Failure::Unhealthy,
            },
        ] {
            assert!(!marks_server_gone(&Effect::Status(status)), "{status:?}");
        }
        assert!(!marks_server_gone(&Effect::LeaveApp));
        assert!(!marks_server_gone(&Effect::CloseStdin(1)));
    }

    #[test]
    fn arming_a_timer_again_replaces_the_pending_one() {
        let now = Instant::now();
        let mut timers = Vec::new();
        arm(&mut timers, now + Duration::from_secs(5), Timer::Probe(1));
        arm(&mut timers, now + Duration::from_secs(1), Timer::Probe(2));
        arm(&mut timers, now + Duration::from_secs(7), Timer::Probe(1));
        assert_eq!(timers.len(), 2);
        assert!(timers.contains(&(now + Duration::from_secs(7), Timer::Probe(1))));
        assert!(timers.contains(&(now + Duration::from_secs(1), Timer::Probe(2))));
    }
}
