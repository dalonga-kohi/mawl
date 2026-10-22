//! Edge cases for the supervisor state machine, through its public API only.

use mawl_host::machine::{
    Effect, Event, Failure, Gen, Health, Machine, Stage, Status, Timer, BACKOFF_MS,
    BOOT_TIMEOUT_MS, MAX_RESTARTS, RESTART_WINDOW_MS, STOP_GRACE_MS, UNHEALTHY_LIMIT,
};

fn has(out: &[Effect], e: Effect) -> bool {
    out.contains(&e)
}

fn last_status(out: &[Effect]) -> Option<Status> {
    out.iter().rev().find_map(|e| match e {
        Effect::Status(s) => Some(*s),
        _ => None,
    })
}

fn spawned(out: &[Effect]) -> Option<Gen> {
    out.iter().find_map(|e| match e {
        Effect::Spawn(g) => Some(*g),
        _ => None,
    })
}

fn restart_seq(out: &[Effect]) -> Option<u64> {
    out.iter().find_map(|e| match e {
        Effect::SetTimer {
            timer: Timer::Restart(seq),
            ..
        } => Some(*seq),
        _ => None,
    })
}

/// The live server crashes at `at`, and its backoff timer fires right away (also at `at`).
/// Returns the effects of the respawn, or the crash effects when the machine gave up.
fn crash_and_respawn(m: &mut Machine, gen: Gen, at: u64) -> Vec<Effect> {
    let out = m.handle(Event::Exited(gen, Some(1)), at);
    match restart_seq(&out) {
        Some(seq) => m.handle(Event::Timer(Timer::Restart(seq)), at),
        None => out,
    }
}

fn ready() -> Machine {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    m.handle(Event::Health(1, Health::Ok), 10);
    assert_eq!(m.status(), Status::Ready);
    m
}

#[test]
fn backoff_doubles_per_attempt_and_the_sixth_failure_is_final() {
    let mut m = Machine::new();
    let mut gen = spawned(&m.handle(Event::Start, 0)).unwrap();
    for (i, delay) in BACKOFF_MS.iter().enumerate() {
        let out = m.handle(Event::Exited(gen, Some(1)), 1_000 * i as u64);
        assert!(
            has(
                &out,
                Effect::SetTimer {
                    timer: Timer::Restart(restart_seq(&out).unwrap()),
                    after_ms: *delay
                }
            ),
            "attempt {}",
            i + 1
        );
        assert_eq!(
            last_status(&out),
            Some(Status::Restarting {
                attempt: i as u32 + 1,
                reason: Failure::Exited { code: Some(1) },
                retry_in_ms: Some(*delay)
            })
        );
        let out = m.handle(
            Event::Timer(Timer::Restart(restart_seq(&out).unwrap())),
            1_000 * i as u64,
        );
        gen = spawned(&out).unwrap();
    }
    let out = m.handle(Event::Exited(gen, Some(1)), 10_000);
    assert_eq!(
        last_status(&out),
        Some(Status::Failed {
            reason: Failure::Exited { code: Some(1) }
        })
    );
    assert!(restart_seq(&out).is_none());
}

#[test]
fn the_window_edge_is_exact() {
    // Five restarts at t = 0..4 ms; the sixth failure decides.
    for (sixth_at, expect_restart) in [
        (RESTART_WINDOW_MS - 1, false),
        (RESTART_WINDOW_MS, true),
        (RESTART_WINDOW_MS + 4, true),
    ] {
        let mut m = Machine::new();
        let mut gen = spawned(&m.handle(Event::Start, 0)).unwrap();
        for t in 0..MAX_RESTARTS as u64 {
            gen = spawned(&crash_and_respawn(&mut m, gen, t)).unwrap();
        }
        let out = m.handle(Event::Exited(gen, None), sixth_at);
        assert_eq!(restart_seq(&out).is_some(), expect_restart, "at {sixth_at}");
        if !expect_restart {
            assert_eq!(
                last_status(&out),
                Some(Status::Failed {
                    reason: Failure::Exited { code: None }
                })
            );
        }
    }
}

#[test]
fn old_failures_age_out_so_a_long_lived_server_gets_attempt_one_again() {
    let mut m = Machine::new();
    let mut gen = spawned(&m.handle(Event::Start, 0)).unwrap();
    for t in 0..4 {
        gen = spawned(&crash_and_respawn(&mut m, gen, t)).unwrap();
    }
    let out = m.handle(Event::Exited(gen, Some(2)), 2 * RESTART_WINDOW_MS);
    assert_eq!(
        last_status(&out),
        Some(Status::Restarting {
            attempt: 1,
            reason: Failure::Exited { code: Some(2) },
            retry_in_ms: Some(BACKOFF_MS[0])
        })
    );
}

#[test]
fn retry_after_failure_clears_the_window_and_only_then() {
    let mut m = Machine::new();
    let mut gen = spawned(&m.handle(Event::Start, 0)).unwrap();
    for t in 0..MAX_RESTARTS as u64 {
        gen = spawned(&crash_and_respawn(&mut m, gen, t)).unwrap();
    }
    m.handle(Event::Exited(gen, Some(1)), 100);
    assert!(matches!(m.status(), Status::Failed { .. }));
    let out = m.handle(Event::Retry, 200);
    let gen = spawned(&out).expect("retry spawns");
    assert_eq!(gen, 7);
    // A fresh window: the next crash is attempt 1, not final.
    let out = m.handle(Event::Exited(gen, Some(1)), 300);
    assert!(matches!(
        last_status(&out),
        Some(Status::Restarting { attempt: 1, .. })
    ));
    // Retry while not failed does nothing.
    assert!(m.handle(Event::Retry, 400).is_empty());
}

#[test]
fn late_events_of_a_replaced_server_change_nothing() {
    let mut m = ready();
    let seq = restart_seq(&m.handle(Event::Exited(1, Some(1)), 100)).unwrap();
    let gen2 = spawned(&m.handle(Event::Timer(Timer::Restart(seq)), 1_100)).unwrap();
    assert_eq!(gen2, 2);
    for stale in [
        Event::Health(1, Health::Ok),
        Event::Health(1, Health::Unhealthy),
        Event::Progress(1, Stage::Server),
        Event::Exited(1, Some(9)),
        Event::SpawnFailed(1),
        Event::LaunchFailed(1),
        Event::Timer(Timer::Probe(1)),
        Event::Timer(Timer::BootDeadline(1)),
        Event::Timer(Timer::KillDeadline(1)),
        // A restart timer of an earlier wait.
        Event::Timer(Timer::Restart(seq)),
    ] {
        assert!(m.handle(stale, 1_200).is_empty(), "{stale:?}");
    }
    assert_eq!(
        m.status(),
        Status::Starting {
            stage: Stage::Database
        }
    );
}

#[test]
fn a_stale_restart_timer_cannot_cut_a_later_backoff_short() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    let seq1 = restart_seq(&m.handle(Event::Exited(1, Some(1)), 0)).unwrap();
    let gen2 = spawned(&m.handle(Event::Timer(Timer::Restart(seq1)), 1_000)).unwrap();
    let seq2 = restart_seq(&m.handle(Event::Exited(gen2, Some(1)), 1_500)).unwrap();
    assert_ne!(seq1, seq2);
    assert!(m
        .handle(Event::Timer(Timer::Restart(seq1)), 1_600)
        .is_empty());
    assert!(spawned(&m.handle(Event::Timer(Timer::Restart(seq2)), 3_500)).is_some());
}

#[test]
fn quit_during_boot_closes_stdin_then_exits_last_when_the_process_ends() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    let out = m.handle(Event::Stop, 50);
    assert!(has(&out, Effect::CloseStdin(1)));
    assert!(has(
        &out,
        Effect::SetTimer {
            timer: Timer::KillDeadline(1),
            after_ms: STOP_GRACE_MS
        }
    ));
    assert_eq!(last_status(&out), Some(Status::Stopping));
    // A second quit and late probes do not repeat anything.
    assert!(m.handle(Event::Stop, 60).is_empty());
    assert!(m.handle(Event::Timer(Timer::Probe(1)), 400).is_empty());
    assert!(m
        .handle(Event::Timer(Timer::BootDeadline(1)), BOOT_TIMEOUT_MS)
        .is_empty());
    assert!(m.handle(Event::Health(1, Health::Ok), 500).is_empty());
    assert!(!m
        .handle(Event::Timer(Timer::KillDeadline(1)), 30_050)
        .is_empty());
    let out = m.handle(Event::Exited(1, Some(0)), 30_100);
    assert_eq!(out.last(), Some(&Effect::Exit));
    assert_eq!(last_status(&out), Some(Status::Stopped));
    // Nothing after Stopped can restart it or exit twice.
    for e in [Event::Start, Event::Retry, Event::Stop] {
        assert!(!m
            .handle(e, 30_200)
            .iter()
            .any(|x| matches!(x, Effect::Spawn(_) | Effect::Exit)));
    }
}

#[test]
fn quit_while_waiting_to_restart_exits_at_once_and_the_timer_does_nothing() {
    let mut m = ready();
    let seq = restart_seq(&m.handle(Event::Exited(1, Some(1)), 100)).unwrap();
    let out = m.handle(Event::Stop, 200);
    assert_eq!(out.last(), Some(&Effect::Exit));
    assert!(m
        .handle(Event::Timer(Timer::Restart(seq)), 1_100)
        .is_empty());
}

#[test]
fn quit_while_recycling_does_not_restart_afterwards() {
    let mut m = ready();
    for t in 0..UNHEALTHY_LIMIT {
        m.handle(Event::Health(1, Health::Unreachable), 1_000 + t as u64);
    }
    assert!(matches!(
        m.status(),
        Status::Restarting {
            retry_in_ms: None,
            ..
        }
    ));
    let out = m.handle(Event::Stop, 5_000);
    assert!(has(&out, Effect::CloseStdin(1)));
    let out = m.handle(Event::Exited(1, Some(0)), 5_100);
    assert_eq!(out.last(), Some(&Effect::Exit));
    assert!(spawned(&out).is_none());
}

#[test]
fn quit_after_the_server_failed_for_good_exits() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    m.handle(Event::LaunchFailed(1), 1);
    assert_eq!(
        m.status(),
        Status::Failed {
            reason: Failure::NotInstalled
        }
    );
    assert_eq!(m.handle(Event::Stop, 2).last(), Some(&Effect::Exit));
}

#[test]
fn a_launch_failure_while_quitting_still_exits() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    m.handle(Event::Stop, 1);
    assert_eq!(
        m.handle(Event::LaunchFailed(1), 2).last(),
        Some(&Effect::Exit)
    );
}

#[test]
fn flapping_503_never_recycles_unless_the_bad_answers_are_consecutive() {
    let mut m = ready();
    for round in 0..20u64 {
        // UNHEALTHY_LIMIT - 1 bad answers, then a good one, over and over.
        for i in 0..UNHEALTHY_LIMIT - 1 {
            let out = m.handle(Event::Health(1, Health::Unhealthy), round * 100 + i as u64);
            assert!(!has(&out, Effect::CloseStdin(1)));
        }
        m.handle(Event::Health(1, Health::Ok), round * 100 + 50);
    }
    assert_eq!(m.status(), Status::Ready);
}

#[test]
fn a_mix_of_bad_answers_counts_together_and_leaves_the_app() {
    let mut m = ready();
    m.handle(Event::Health(1, Health::Unreachable), 100);
    m.handle(Event::Health(1, Health::Unhealthy), 200);
    let out = m.handle(Event::Health(1, Health::Unreachable), 300);
    assert!(has(&out, Effect::LeaveApp));
    // Late probe results while recycling are ignored.
    assert!(m.handle(Event::Health(1, Health::Ok), 400).is_empty());
    // The recycled process exits: the reason stays Unhealthy, not Exited.
    let out = m.handle(Event::Exited(1, Some(0)), 500);
    assert!(matches!(
        last_status(&out),
        Some(Status::Restarting {
            reason: Failure::Unhealthy,
            retry_in_ms: Some(_),
            ..
        })
    ));
}

#[test]
fn a_recycle_that_hangs_is_killed_after_the_grace_then_a_late_deadline_is_ignored() {
    let mut m = ready();
    for t in 0..UNHEALTHY_LIMIT {
        m.handle(Event::Health(1, Health::Unhealthy), t as u64);
    }
    assert!(has(
        &m.handle(Event::Timer(Timer::KillDeadline(1)), STOP_GRACE_MS),
        Effect::Kill(1)
    ));
    let seq = restart_seq(&m.handle(Event::Exited(1, None), STOP_GRACE_MS + 1)).unwrap();
    let gen2 = spawned(&m.handle(Event::Timer(Timer::Restart(seq)), STOP_GRACE_MS + 2)).unwrap();
    assert_eq!(gen2, 2);
    assert!(m
        .handle(Event::Timer(Timer::KillDeadline(1)), STOP_GRACE_MS + 3)
        .is_empty());
}

#[test]
fn boot_timeout_kills_and_restarts_with_that_reason() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    let out = m.handle(Event::Timer(Timer::BootDeadline(1)), BOOT_TIMEOUT_MS);
    assert!(has(&out, Effect::Kill(1)));
    let out = m.handle(Event::Exited(1, None), BOOT_TIMEOUT_MS + 5);
    assert!(matches!(
        last_status(&out),
        Some(Status::Restarting {
            reason: Failure::BootTimeout,
            attempt: 1,
            ..
        })
    ));
}

#[test]
fn a_spawn_failure_retries_with_backoff_and_gives_up_as_spawn_failed() {
    let mut m = Machine::new();
    let mut gen = spawned(&m.handle(Event::Start, 0)).unwrap();
    for t in 0..MAX_RESTARTS as u64 {
        let out = m.handle(Event::SpawnFailed(gen), t);
        gen = spawned(&m.handle(Event::Timer(Timer::Restart(restart_seq(&out).unwrap())), t))
            .unwrap();
    }
    let out = m.handle(Event::SpawnFailed(gen), 10);
    assert_eq!(
        last_status(&out),
        Some(Status::Failed {
            reason: Failure::SpawnFailed
        })
    );
}

#[test]
fn a_server_crash_while_ready_leaves_the_app_exactly_once() {
    let mut m = ready();
    let out = m.handle(Event::Exited(1, Some(1)), 100);
    assert_eq!(out.iter().filter(|e| **e == Effect::LeaveApp).count(), 1);
    // The first status after the crash is a restart, not "starting".
    assert!(matches!(last_status(&out), Some(Status::Restarting { .. })));
}

#[test]
fn a_new_server_announces_itself_even_when_the_status_reads_the_same() {
    let mut m = Machine::new();
    m.handle(Event::Start, 0);
    // Crash while still on the database stage; the respawn shows the same stage again.
    let seq = restart_seq(&m.handle(Event::Exited(1, Some(1)), 0)).unwrap();
    let out = m.handle(Event::Timer(Timer::Restart(seq)), 1_000);
    assert_eq!(
        last_status(&out),
        Some(Status::Starting {
            stage: Stage::Database
        })
    );
}
