//! The supervisor's decisions, with no IO: events in, effects out. Time is a monotonic
//! millisecond count passed with every event, so the restart window and backoff are testable
//! without sleeping. The driver (`driver.rs`) owns the process, the timers and the HTTP probe.
//!
//! Every process gets a new generation number. Events and timers carry it, and anything from an
//! older generation is ignored, so a late exit or probe of a replaced server cannot touch the new
//! one.

use std::collections::VecDeque;

use serde::Serialize;

/// At most this many restarts inside [`RESTART_WINDOW_MS`]; the next failure is final.
pub const MAX_RESTARTS: usize = 5;
pub const RESTART_WINDOW_MS: u64 = 5 * 60 * 1000;
/// Delay before restart number n (1-based) is `BACKOFF_MS[n - 1]`.
pub const BACKOFF_MS: [u64; MAX_RESTARTS] = [1_000, 2_000, 4_000, 8_000, 16_000];
/// A cold first run (initdb), WAL recovery (up to 60 s) and migrations must fit in here.
pub const BOOT_TIMEOUT_MS: u64 = 120_000;
/// After stdin closes the server has a 10 s shutdown deadline plus up to 15 s of `pg_ctl stop`.
pub const STOP_GRACE_MS: u64 = 30_000;
/// How often `/healthz` is asked while the server boots, once ready, and after a bad answer.
pub const PROBE_BOOT_MS: u64 = 400;
pub const PROBE_READY_MS: u64 = 5_000;
pub const PROBE_RETRY_MS: u64 = 2_000;
/// This many bad answers in a row (503, refused, timed out) make a ready server restart.
pub const UNHEALTHY_LIMIT: u32 = 3;

/// One server process. Starts at 1; 0 never names a process.
pub type Gen = u64;

/// What the server is doing while it boots, as far as the host can tell from its log.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    /// Secrets, the embedded Postgres and migrations.
    Database,
    /// The run worker, the API and the listener, until `/healthz` answers 200.
    Server,
}

/// Why a server stopped being usable. Shown on the restarting and failed screens.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Failure {
    /// The process could not be started (missing files, access denied).
    SpawnFailed,
    /// The process ended on its own. `code` is `None` when it was killed.
    Exited { code: Option<i32> },
    /// `/healthz` kept failing, for example because its Postgres died.
    Unhealthy,
    /// The server did not become healthy within [`BOOT_TIMEOUT_MS`].
    BootTimeout,
    /// The server's files are missing: a restart cannot help, reinstalling can.
    NotInstalled,
}

/// The answer of one `/healthz` probe.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Health {
    Ok,
    /// Answered, but not 200 (503 when the database is gone).
    Unhealthy,
    /// Refused, timed out or not HTTP.
    Unreachable,
    /// A 200 without the proof that it knows the launch token: another program holds the port.
    /// Never ready; treated like a bad answer.
    Foreign,
}

/// What the window shows. Serialized for the splash as `{ "phase": ..., ... }`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Status {
    Starting {
        stage: Stage,
    },
    Ready,
    Restarting {
        /// 1-based count of restarts in the current window.
        attempt: u32,
        reason: Failure,
        /// Set while waiting out the backoff; `None` while the old process is still stopping.
        retry_in_ms: Option<u64>,
    },
    Stopping,
    Stopped,
    Failed {
        reason: Failure,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Timer {
    Probe(Gen),
    BootDeadline(Gen),
    KillDeadline(Gen),
    /// The end of a backoff; the number tells one wait from the next.
    Restart(u64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Event {
    /// Start the first server.
    Start,
    SpawnFailed(Gen),
    /// The server's files are missing; final, no restarts.
    LaunchFailed(Gen),
    /// The server's log shows it reached this stage.
    Progress(Gen, Stage),
    Health(Gen, Health),
    /// The server process ended. `None`: killed or no exit code.
    Exited(Gen, Option<i32>),
    Timer(Timer),
    /// "Quit Mawl" or the app is exiting.
    Stop,
    /// "Try again" on the failed screen.
    Retry,
    /// The PC woke from sleep: ask `/healthz` now instead of at the next timer, because the
    /// state the last probe left may be stale.
    ProbeNow,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Effect {
    /// Start a server process for this generation (stdin held open, token on its first line).
    Spawn(Gen),
    Probe(Gen),
    /// Close the server's stdin: its parent watchdog then shuts it down cleanly.
    CloseStdin(Gen),
    /// End the process tree now (the job object).
    Kill(Gen),
    SetTimer {
        timer: Timer,
        after_ms: u64,
    },
    Status(Status),
    /// The app page is showing a server that is going away: go back to the splash.
    LeaveApp,
    /// Everything is stopped: the app may exit.
    Exit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Idle,
    Starting(Stage),
    Ready,
    /// The old process is being stopped before a restart.
    Recycling(Failure),
    /// Waiting out the backoff; the process is gone.
    Waiting {
        seq: u64,
        attempt: u32,
        reason: Failure,
    },
    Stopping,
    Stopped,
    Failed(Failure),
}

#[derive(Debug)]
pub struct Machine {
    phase: Phase,
    /// The generation of the live process, if one is running.
    running: Option<Gen>,
    last_gen: Gen,
    restart_seq: u64,
    /// When each restart in the window happened.
    restarts: VecDeque<u64>,
    bad_probes: u32,
}

impl Default for Machine {
    fn default() -> Self {
        Self::new()
    }
}

impl Machine {
    pub fn new() -> Self {
        Self {
            phase: Phase::Idle,
            running: None,
            last_gen: 0,
            restart_seq: 0,
            restarts: VecDeque::new(),
            bad_probes: 0,
        }
    }

    /// The status to show right now (the splash asks for it when it loads).
    pub fn status(&self) -> Status {
        match self.phase {
            Phase::Idle => Status::Starting {
                stage: Stage::Database,
            },
            Phase::Starting(stage) => Status::Starting { stage },
            Phase::Ready => Status::Ready,
            Phase::Recycling(reason) => Status::Restarting {
                attempt: self.attempt_after_recycle(),
                reason,
                retry_in_ms: None,
            },
            Phase::Waiting {
                attempt, reason, ..
            } => Status::Restarting {
                attempt,
                reason,
                retry_in_ms: Some(BACKOFF_MS[attempt as usize - 1]),
            },
            Phase::Stopping => Status::Stopping,
            Phase::Stopped => Status::Stopped,
            Phase::Failed(reason) => Status::Failed { reason },
        }
    }

    pub fn handle(&mut self, event: Event, now_ms: u64) -> Vec<Effect> {
        let mut out = Vec::new();
        let was_ready = self.phase == Phase::Ready;
        let before = self.status();
        match event {
            Event::Start => {
                if self.phase == Phase::Idle {
                    self.spawn(&mut out);
                }
            }
            Event::Retry => {
                if let Phase::Failed(_) = self.phase {
                    self.restarts.clear();
                    self.spawn(&mut out);
                }
            }
            Event::SpawnFailed(gen) => {
                if self.is_current(gen) {
                    self.running = None;
                    self.after_exit(Failure::SpawnFailed, now_ms, &mut out);
                }
            }
            Event::LaunchFailed(gen) => {
                if self.is_current(gen) {
                    self.running = None;
                    self.phase = if self.phase == Phase::Stopping {
                        out.push(Effect::Exit);
                        Phase::Stopped
                    } else {
                        Phase::Failed(Failure::NotInstalled)
                    };
                }
            }
            Event::Progress(gen, stage) => {
                if self.is_current(gen) {
                    if let Phase::Starting(Stage::Database) = self.phase {
                        if stage == Stage::Server {
                            self.phase = Phase::Starting(Stage::Server);
                        }
                    }
                }
            }
            Event::Health(gen, health) => {
                if self.is_current(gen) {
                    self.on_health(gen, health, &mut out);
                }
            }
            Event::Exited(gen, code) => {
                if self.is_current(gen) {
                    self.running = None;
                    let reason = match self.phase {
                        Phase::Recycling(reason) => reason,
                        _ => Failure::Exited { code },
                    };
                    self.after_exit(reason, now_ms, &mut out);
                }
            }
            Event::Timer(timer) => self.on_timer(timer, &mut out),
            Event::ProbeNow => {
                // Same condition as the probe timer: only a booting or ready server is probed.
                if let (Some(gen), Phase::Starting(_) | Phase::Ready) = (self.running, self.phase) {
                    out.push(Effect::Probe(gen));
                }
            }
            Event::Stop => self.on_stop(&mut out),
        }
        if was_ready && self.phase != Phase::Ready {
            out.push(Effect::LeaveApp);
        }
        let after = self.status();
        // A new server always announces itself, even when the status reads the same as before.
        if after != before || out.iter().any(|e| matches!(e, Effect::Spawn(_))) {
            out.push(Effect::Status(after));
        }
        // Exit is always last, so the window hears the final status before the app goes.
        if let Some(i) = out.iter().position(|e| *e == Effect::Exit) {
            let exit = out.remove(i);
            out.push(exit);
        }
        out
    }

    fn is_current(&self, gen: Gen) -> bool {
        self.running == Some(gen)
    }

    fn spawn(&mut self, out: &mut Vec<Effect>) {
        self.last_gen += 1;
        let gen = self.last_gen;
        self.running = Some(gen);
        self.bad_probes = 0;
        self.phase = Phase::Starting(Stage::Database);
        out.push(Effect::Spawn(gen));
        out.push(Effect::SetTimer {
            timer: Timer::Probe(gen),
            after_ms: PROBE_BOOT_MS,
        });
        out.push(Effect::SetTimer {
            timer: Timer::BootDeadline(gen),
            after_ms: BOOT_TIMEOUT_MS,
        });
    }

    fn on_health(&mut self, gen: Gen, health: Health, out: &mut Vec<Effect>) {
        let next_probe = match (self.phase, health) {
            (Phase::Starting(_), Health::Ok) => {
                self.phase = Phase::Ready;
                self.bad_probes = 0;
                PROBE_READY_MS
            }
            // Booting: not listening yet, or the database is still coming up.
            (Phase::Starting(_), _) => PROBE_BOOT_MS,
            (Phase::Ready, Health::Ok) => {
                self.bad_probes = 0;
                PROBE_READY_MS
            }
            (Phase::Ready, _) => {
                self.bad_probes += 1;
                if self.bad_probes >= UNHEALTHY_LIMIT {
                    // The server never exits when its Postgres dies: stop it and start a new one.
                    self.phase = Phase::Recycling(Failure::Unhealthy);
                    self.stop_process(gen, out);
                    return;
                }
                PROBE_RETRY_MS
            }
            _ => return,
        };
        out.push(Effect::SetTimer {
            timer: Timer::Probe(gen),
            after_ms: next_probe,
        });
    }

    fn on_timer(&mut self, timer: Timer, out: &mut Vec<Effect>) {
        match timer {
            Timer::Probe(gen) => {
                if self.is_current(gen) && matches!(self.phase, Phase::Starting(_) | Phase::Ready) {
                    out.push(Effect::Probe(gen));
                }
            }
            Timer::BootDeadline(gen) => {
                if self.is_current(gen) && matches!(self.phase, Phase::Starting(_)) {
                    // A hung boot ignores stdin until it settles, so end it now.
                    self.phase = Phase::Recycling(Failure::BootTimeout);
                    out.push(Effect::Kill(gen));
                }
            }
            Timer::KillDeadline(gen) => {
                if self.is_current(gen) {
                    out.push(Effect::Kill(gen));
                }
            }
            Timer::Restart(seq) => {
                if let Phase::Waiting { seq: waiting, .. } = self.phase {
                    if waiting == seq {
                        self.spawn(out);
                    }
                }
            }
        }
    }

    fn on_stop(&mut self, out: &mut Vec<Effect>) {
        match self.running {
            Some(gen) => {
                if self.phase != Phase::Stopping {
                    self.phase = Phase::Stopping;
                    self.stop_process(gen, out);
                }
            }
            None => {
                if self.phase != Phase::Stopped {
                    self.phase = Phase::Stopped;
                    out.push(Effect::Exit);
                }
            }
        }
    }

    /// Graceful first: closing stdin lets the server stop its Postgres; the job kills the rest.
    fn stop_process(&mut self, gen: Gen, out: &mut Vec<Effect>) {
        out.push(Effect::CloseStdin(gen));
        out.push(Effect::SetTimer {
            timer: Timer::KillDeadline(gen),
            after_ms: STOP_GRACE_MS,
        });
    }

    /// The process is gone (or never started). Decide between done, a restart, and giving up.
    fn after_exit(&mut self, reason: Failure, now_ms: u64, out: &mut Vec<Effect>) {
        if self.phase == Phase::Stopping {
            self.phase = Phase::Stopped;
            out.push(Effect::Exit);
            return;
        }
        while let Some(&oldest) = self.restarts.front() {
            if now_ms.saturating_sub(oldest) >= RESTART_WINDOW_MS {
                self.restarts.pop_front();
            } else {
                break;
            }
        }
        if self.restarts.len() >= MAX_RESTARTS {
            self.phase = Phase::Failed(reason);
            return;
        }
        self.restarts.push_back(now_ms);
        let attempt = self.restarts.len() as u32;
        self.restart_seq += 1;
        self.phase = Phase::Waiting {
            seq: self.restart_seq,
            attempt,
            reason,
        };
        out.push(Effect::SetTimer {
            timer: Timer::Restart(self.restart_seq),
            after_ms: BACKOFF_MS[attempt as usize - 1],
        });
    }

    /// The attempt number a restart after the current recycle will get (window not yet pruned).
    fn attempt_after_recycle(&self) -> u32 {
        (self.restarts.len() + 1).min(MAX_RESTARTS) as u32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: u64 = 60_000;

    fn has(out: &[Effect], effect: Effect) -> bool {
        out.contains(&effect)
    }

    fn last_status(out: &[Effect]) -> Option<Status> {
        out.iter().rev().find_map(|e| match e {
            Effect::Status(s) => Some(*s),
            _ => None,
        })
    }

    /// A machine whose first server (gen 1) is ready.
    fn ready() -> Machine {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        m.handle(Event::Health(1, Health::Ok), 100);
        assert_eq!(m.status(), Status::Ready);
        m
    }

    #[test]
    fn start_spawns_the_first_server_and_reports_the_database_stage() {
        let mut m = Machine::new();
        let out = m.handle(Event::Start, 0);
        assert!(has(&out, Effect::Spawn(1)));
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::Probe(1),
                after_ms: PROBE_BOOT_MS
            }
        ));
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::BootDeadline(1),
                after_ms: BOOT_TIMEOUT_MS
            }
        ));
        assert_eq!(
            last_status(&out),
            Some(Status::Starting {
                stage: Stage::Database
            })
        );
        // A second Start is ignored.
        assert!(m.handle(Event::Start, 1).is_empty());
    }

    #[test]
    fn progress_moves_to_the_server_stage_once() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::Progress(1, Stage::Server), 10);
        assert_eq!(
            last_status(&out),
            Some(Status::Starting {
                stage: Stage::Server
            })
        );
        assert!(m.handle(Event::Progress(1, Stage::Database), 11).is_empty());
    }

    #[test]
    fn probes_keep_polling_while_booting_and_a_200_means_ready() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        assert_eq!(
            m.handle(Event::Timer(Timer::Probe(1)), 400),
            vec![Effect::Probe(1)]
        );
        for health in [Health::Unreachable, Health::Unhealthy] {
            let out = m.handle(Event::Health(1, health), 500);
            assert_eq!(
                out,
                vec![Effect::SetTimer {
                    timer: Timer::Probe(1),
                    after_ms: PROBE_BOOT_MS
                }]
            );
        }
        let out = m.handle(Event::Health(1, Health::Ok), 600);
        assert_eq!(last_status(&out), Some(Status::Ready));
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::Probe(1),
                after_ms: PROBE_READY_MS
            }
        ));
        // The boot deadline no longer applies.
        assert!(m
            .handle(Event::Timer(Timer::BootDeadline(1)), BOOT_TIMEOUT_MS)
            .is_empty());
    }

    #[test]
    fn a_persistent_503_recycles_the_server_gracefully_then_restarts_it() {
        let mut m = ready();
        let out = m.handle(Event::Health(1, Health::Unhealthy), 1_000);
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::Probe(1),
                after_ms: PROBE_RETRY_MS
            }
        ));
        m.handle(Event::Health(1, Health::Unhealthy), 3_000);
        let out = m.handle(Event::Health(1, Health::Unhealthy), 5_000);
        assert!(has(&out, Effect::CloseStdin(1)));
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::KillDeadline(1),
                after_ms: STOP_GRACE_MS
            }
        ));
        assert!(has(&out, Effect::LeaveApp));
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: 1,
                reason: Failure::Unhealthy,
                retry_in_ms: None
            })
        );
        // Probes stop while it shuts down.
        assert!(m.handle(Event::Timer(Timer::Probe(1)), 6_000).is_empty());

        let out = m.handle(Event::Exited(1, Some(0)), 7_000);
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::Restart(1),
                after_ms: BACKOFF_MS[0]
            }
        ));
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: 1,
                reason: Failure::Unhealthy,
                retry_in_ms: Some(BACKOFF_MS[0])
            })
        );
        let out = m.handle(Event::Timer(Timer::Restart(1)), 8_000);
        assert!(has(&out, Effect::Spawn(2)));
    }

    #[test]
    fn an_answer_without_the_proof_is_never_ready_and_counts_as_bad() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::Health(1, Health::Foreign), 400);
        assert!(!out
            .iter()
            .any(|e| matches!(e, Effect::Status(Status::Ready))));
        assert_eq!(
            m.status(),
            Status::Starting {
                stage: Stage::Database
            }
        );

        let mut m = ready();
        for t in 0..UNHEALTHY_LIMIT as u64 {
            m.handle(Event::Health(1, Health::Foreign), 1_000 + t);
        }
        assert!(matches!(m.status(), Status::Restarting { .. }));
    }

    #[test]
    fn a_good_answer_resets_the_bad_probe_count() {
        let mut m = ready();
        m.handle(Event::Health(1, Health::Unhealthy), 1_000);
        m.handle(Event::Health(1, Health::Unreachable), 2_000);
        m.handle(Event::Health(1, Health::Ok), 3_000);
        m.handle(Event::Health(1, Health::Unhealthy), 4_000);
        let out = m.handle(Event::Health(1, Health::Unhealthy), 5_000);
        assert!(!has(&out, Effect::CloseStdin(1)));
        assert_eq!(m.status(), Status::Ready);
    }

    #[test]
    fn a_recycle_that_ignores_stdin_is_killed_at_the_deadline() {
        let mut m = ready();
        for t in 0..3 {
            m.handle(Event::Health(1, Health::Unhealthy), 1_000 + t);
        }
        let out = m.handle(Event::Timer(Timer::KillDeadline(1)), 40_000);
        assert_eq!(out, vec![Effect::Kill(1)]);
    }

    #[test]
    fn an_unexpected_exit_restarts_with_growing_backoff() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let mut now = 0;
        for (i, delay) in BACKOFF_MS.iter().enumerate() {
            let gen = i as u64 + 1;
            now += 1_000;
            let out = m.handle(Event::Exited(gen, Some(1)), now);
            assert_eq!(
                last_status(&out),
                Some(Status::Restarting {
                    attempt: gen as u32,
                    reason: Failure::Exited { code: Some(1) },
                    retry_in_ms: Some(*delay)
                })
            );
            assert!(has(
                &out,
                Effect::SetTimer {
                    timer: Timer::Restart(gen),
                    after_ms: *delay
                }
            ));
            now += delay;
            let out = m.handle(Event::Timer(Timer::Restart(gen)), now);
            assert!(has(&out, Effect::Spawn(gen + 1)));
        }
    }

    #[test]
    fn the_sixth_failure_within_five_minutes_is_final() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        for gen in 1..=5u64 {
            m.handle(Event::Exited(gen, Some(1)), gen * 1_000);
            m.handle(Event::Timer(Timer::Restart(gen)), gen * 1_000 + 500);
        }
        let out = m.handle(Event::Exited(6, Some(3)), 4 * MIN);
        assert_eq!(
            last_status(&out),
            Some(Status::Failed {
                reason: Failure::Exited { code: Some(3) }
            })
        );
        assert!(!out
            .iter()
            .any(|e| matches!(e, Effect::Spawn(_) | Effect::SetTimer { .. })));
    }

    #[test]
    fn restarts_older_than_the_window_do_not_count() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        for gen in 1..=5u64 {
            m.handle(Event::Exited(gen, Some(1)), gen * 1_000);
            m.handle(Event::Timer(Timer::Restart(gen)), gen * 1_000 + 500);
        }
        // The first restart (t = 1 s) left the window at 5 min + 1 s.
        let out = m.handle(Event::Exited(6, Some(1)), 5 * MIN + 1_000);
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: 5,
                reason: Failure::Exited { code: Some(1) },
                retry_in_ms: Some(BACKOFF_MS[4])
            })
        );
    }

    #[test]
    fn spawn_failures_count_as_failures() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::SpawnFailed(1), 5);
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: 1,
                reason: Failure::SpawnFailed,
                retry_in_ms: Some(BACKOFF_MS[0])
            })
        );
    }

    #[test]
    fn a_missing_install_fails_at_once_without_restarts() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::LaunchFailed(1), 5);
        assert_eq!(
            last_status(&out),
            Some(Status::Failed {
                reason: Failure::NotInstalled
            })
        );
        assert!(!out.iter().any(|e| matches!(e, Effect::SetTimer { .. })));
        // Quit from there exits at once.
        assert!(has(&m.handle(Event::Stop, 10), Effect::Exit));
    }

    #[test]
    fn a_boot_that_hangs_is_killed_and_restarted() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::Timer(Timer::BootDeadline(1)), BOOT_TIMEOUT_MS);
        assert!(has(&out, Effect::Kill(1)));
        let out = m.handle(Event::Exited(1, None), BOOT_TIMEOUT_MS + 10);
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: 1,
                reason: Failure::BootTimeout,
                retry_in_ms: Some(BACKOFF_MS[0])
            })
        );
    }

    #[test]
    fn events_from_an_old_generation_are_ignored() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        m.handle(Event::Exited(1, Some(1)), 10);
        m.handle(Event::Timer(Timer::Restart(1)), 2_000);
        for event in [
            Event::Exited(1, Some(1)),
            Event::Health(1, Health::Ok),
            Event::SpawnFailed(1),
            Event::Progress(1, Stage::Server),
            Event::Timer(Timer::Probe(1)),
            Event::Timer(Timer::KillDeadline(1)),
            Event::Timer(Timer::BootDeadline(1)),
            Event::Timer(Timer::Restart(1)),
        ] {
            assert!(m.handle(event, 3_000).is_empty(), "{event:?}");
        }
        assert_eq!(
            m.status(),
            Status::Starting {
                stage: Stage::Database
            }
        );
    }

    #[test]
    fn quit_closes_stdin_waits_then_kills_and_exits_after_the_process_is_gone() {
        let mut m = ready();
        let out = m.handle(Event::Stop, 1_000);
        assert!(has(&out, Effect::CloseStdin(1)));
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::KillDeadline(1),
                after_ms: STOP_GRACE_MS
            }
        ));
        assert!(has(&out, Effect::LeaveApp));
        assert_eq!(last_status(&out), Some(Status::Stopping));
        assert!(!has(&out, Effect::Exit));
        // A second quit while stopping changes nothing; probes are over.
        assert!(m.handle(Event::Stop, 1_100).is_empty());
        assert!(m.handle(Event::Timer(Timer::Probe(1)), 1_200).is_empty());
        assert!(m
            .handle(Event::Health(1, Health::Unhealthy), 1_300)
            .is_empty());

        assert_eq!(
            m.handle(Event::Timer(Timer::KillDeadline(1)), 31_000),
            vec![Effect::Kill(1)]
        );
        let out = m.handle(Event::Exited(1, None), 31_100);
        assert_eq!(out.last(), Some(&Effect::Exit));
        assert_eq!(last_status(&out), Some(Status::Stopped));
        assert!(!out.iter().any(|e| matches!(e, Effect::SetTimer { .. })));
    }

    #[test]
    fn quit_without_a_process_exits_at_once() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        m.handle(Event::Exited(1, Some(1)), 10);
        let out = m.handle(Event::Stop, 20);
        assert!(has(&out, Effect::Exit));
        assert_eq!(last_status(&out), Some(Status::Stopped));
        // The pending restart never fires.
        assert!(m.handle(Event::Timer(Timer::Restart(1)), 5_000).is_empty());
    }

    #[test]
    fn quit_during_boot_also_waits_for_the_server() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        let out = m.handle(Event::Stop, 10);
        assert!(has(&out, Effect::CloseStdin(1)));
        assert!(!has(&out, Effect::LeaveApp));
        let out = m.handle(Event::Exited(1, Some(0)), 2_000);
        assert!(has(&out, Effect::Exit));
    }

    #[test]
    fn try_again_after_failing_starts_fresh() {
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        for gen in 1..=5u64 {
            m.handle(Event::Exited(gen, Some(1)), gen);
            m.handle(Event::Timer(Timer::Restart(gen)), gen);
        }
        m.handle(Event::Exited(6, Some(1)), 100);
        assert!(matches!(m.status(), Status::Failed { .. }));
        let out = m.handle(Event::Retry, 200);
        assert!(has(&out, Effect::Spawn(7)));
        assert_eq!(
            last_status(&out),
            Some(Status::Starting {
                stage: Stage::Database
            })
        );
        // The history was cleared: the next failure is restart 1 again.
        let out = m.handle(Event::Exited(7, Some(1)), 300);
        assert!(matches!(
            last_status(&out),
            Some(Status::Restarting { attempt: 1, .. })
        ));
        // Retry means nothing outside the failed state.
        assert!(m.handle(Event::Retry, 400).is_empty());
    }

    #[test]
    fn waking_from_sleep_probes_a_ready_or_booting_server_at_once() {
        let mut m = ready();
        assert_eq!(m.handle(Event::ProbeNow, 9_000), vec![Effect::Probe(1)]);
        // It changes nothing else: no status, no timers.
        assert_eq!(m.status(), Status::Ready);

        let mut booting = Machine::new();
        booting.handle(Event::Start, 0);
        assert_eq!(
            booting.handle(Event::ProbeNow, 10),
            vec![Effect::Probe(1)]
        );
    }

    #[test]
    fn waking_from_sleep_probes_nothing_when_no_server_is_up() {
        // Before the first start.
        assert!(Machine::new().handle(Event::ProbeNow, 0).is_empty());

        // Stopping, and after the stop.
        let mut m = ready();
        m.handle(Event::Stop, 200);
        assert!(m.handle(Event::ProbeNow, 300).is_empty());
        m.handle(Event::Exited(1, Some(0)), 400);
        assert!(m.handle(Event::ProbeNow, 500).is_empty());

        // Recycling (old process still stopping) and waiting out the backoff.
        let mut m = ready();
        for t in [1_000, 3_000, 5_000] {
            m.handle(Event::Health(1, Health::Unhealthy), t);
        }
        assert!(matches!(m.status(), Status::Restarting { .. }));
        assert!(m.handle(Event::ProbeNow, 5_100).is_empty());
        m.handle(Event::Exited(1, Some(0)), 5_200);
        assert!(m.handle(Event::ProbeNow, 5_300).is_empty());

        // Failed for good.
        let mut m = Machine::new();
        m.handle(Event::Start, 0);
        m.handle(Event::LaunchFailed(1), 1);
        assert!(m.handle(Event::ProbeNow, 2).is_empty());
    }

    #[test]
    fn a_probe_now_answer_follows_the_normal_health_rules() {
        let mut m = ready();
        m.handle(Event::ProbeNow, 9_000);
        // A bad answer after the wake counts like any other bad answer.
        let out = m.handle(Event::Health(1, Health::Unreachable), 9_100);
        assert!(has(
            &out,
            Effect::SetTimer {
                timer: Timer::Probe(1),
                after_ms: PROBE_RETRY_MS
            }
        ));
        assert_eq!(m.status(), Status::Ready);
    }

    #[test]
    fn status_serializes_for_the_splash() {
        let json = serde_json::to_string(&Status::Restarting {
            attempt: 2,
            reason: Failure::Exited { code: Some(1) },
            retry_in_ms: Some(2_000),
        })
        .unwrap();
        assert_eq!(
            json,
            r#"{"phase":"restarting","attempt":2,"reason":{"kind":"exited","code":1},"retry_in_ms":2000}"#
        );
        assert_eq!(
            serde_json::to_string(&Status::Starting {
                stage: Stage::Server
            })
            .unwrap(),
            r#"{"phase":"starting","stage":"server"}"#
        );
    }
}
