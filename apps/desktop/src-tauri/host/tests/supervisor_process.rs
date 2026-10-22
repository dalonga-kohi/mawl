//! The supervisor against a real process: `node` on `tests/fixtures/fake-server.mjs`, which keeps
//! the server's host contract. Skipped (with a note) when `node` is not on PATH.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use mawl_host::driver::{HostUi, Supervisor, SupervisorConfig};
use mawl_host::launch::ServerCommand;
use mawl_host::machine::{Failure, Status};
use mawl_host::master_key::{self, KeyStore, MemoryStore};
use mawl_host::port;
use mawl_host::process::ServerProcess;
use mawl_host::token::{base64url, LaunchToken};
use sha2::{Digest, Sha256};

fn node() -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(if cfg!(windows) { "node.exe" } else { "node" }))
        .find(|p| p.is_file())
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-server.mjs")
}

/// A fresh data dir with the fake server's behavior file.
fn data_dir(name: &str, behavior: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mawl-host-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("behavior"), behavior).unwrap();
    dir
}

#[derive(Debug)]
enum UiEvent {
    Status(Status),
    LeaveApp,
    ServerGone,
    Exit,
}

struct TestUi(Mutex<Sender<UiEvent>>);

impl HostUi for TestUi {
    fn status(&self, status: Status) {
        let _ = self.0.lock().unwrap().send(UiEvent::Status(status));
    }
    fn leave_app(&self) {
        let _ = self.0.lock().unwrap().send(UiEvent::LeaveApp);
    }
    fn server_gone(&self) {
        let _ = self.0.lock().unwrap().send(UiEvent::ServerGone);
    }
    fn exit(&self) {
        let _ = self.0.lock().unwrap().send(UiEvent::Exit);
    }
}

fn wait_for(
    rx: &Receiver<UiEvent>,
    within: Duration,
    mut done: impl FnMut(&UiEvent) -> bool,
) -> Vec<UiEvent> {
    let deadline = Instant::now() + within;
    let mut seen = Vec::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        let event = rx
            .recv_timeout(left)
            .unwrap_or_else(|_| panic!("timed out; saw {seen:?}"));
        let stop = done(&event);
        seen.push(event);
        if stop {
            return seen;
        }
    }
}

struct Started {
    supervisor: Supervisor,
    rx: Receiver<UiEvent>,
    token: LaunchToken,
    dir: PathBuf,
    store: Arc<MemoryStore>,
}

fn start(
    name: &str,
    behavior: &str,
) -> Option<(Supervisor, Receiver<UiEvent>, LaunchToken, PathBuf)> {
    start_with(name, behavior, MemoryStore::default(), |_| {})
        .map(|s| (s.supervisor, s.rx, s.token, s.dir))
}

fn start_with(
    name: &str,
    behavior: &str,
    store: MemoryStore,
    prepare: impl FnOnce(&Path),
) -> Option<Started> {
    let Some(node) = node() else {
        eprintln!("skipped: node is not on PATH");
        return None;
    };
    let dir = data_dir(name, behavior);
    prepare(&dir);
    let store = Arc::new(store);
    let key_store: Arc<dyn KeyStore> = store.clone();
    let token = LaunchToken::generate().unwrap();
    let (tx, rx) = mpsc::channel();
    let mut host_env: Vec<(String, String)> = std::env::vars().collect();
    host_env.push(("NODE_OPTIONS".into(), "--max-old-space-size=1".into()));
    host_env.push(("OPENAI_API_KEY".into(), "sk-test".into()));
    let supervisor = Supervisor::start(
        SupervisorConfig {
            command: Ok(ServerCommand {
                program: node,
                script: fixture(),
                pg_root: None,
                web_dir: None,
                dev: false,
            }),
            data_dir: dir.clone(),
            host_env,
            port: port::choose_port(None, |_| false).unwrap(),
            fixed_port: false,
            token: token.clone(),
            key_store,
        },
        TestUi(Mutex::new(tx)),
    );
    Some(Started {
        supervisor,
        rx,
        token,
        dir,
        store,
    })
}

#[test]
fn boots_to_ready_with_a_clean_env_and_quits_through_stdin() {
    let Some((supervisor, rx, token, dir)) = start("ready", "ok") else {
        return;
    };
    let seen = wait_for(&rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Status(Status::Ready))
    });
    assert!(matches!(
        seen.first(),
        Some(UiEvent::Status(Status::Starting { .. }))
    ));
    assert_eq!(supervisor.status(), Status::Ready);

    let text = supervisor.diagnostics(&["Mawl test".into()]);
    assert!(!text.contains(token.expose()), "token leaked:\n{text}");
    assert!(text.contains("warning: token=[redacted]"));
    assert!(text.contains(r#""mode":"desktop""#), "{text}");
    assert!(text.contains(r#""host":"127.0.0.1""#));
    assert!(text.contains(r#""nodeOptions":null"#));
    assert!(text.contains(r#""secret":null"#));
    assert!(text.contains(r#""tokenLength":43"#));

    let asked = Instant::now();
    supervisor.stop();
    let seen = wait_for(&rx, Duration::from_secs(20), |e| matches!(e, UiEvent::Exit));
    assert!(seen.iter().any(|e| matches!(e, UiEvent::LeaveApp)));
    assert!(seen
        .iter()
        .any(|e| matches!(e, UiEvent::Status(Status::Stopped))));
    // The host hears that the server is gone before any call that could block on the UI thread\n    // (the final status, the exit), so a logoff wait never depends on them.\n    let position = |wanted: fn(&UiEvent) -> bool| seen.iter().position(wanted).unwrap();\n    let gone = position(|e| matches!(e, UiEvent::ServerGone));\n    assert!(gone < position(|e| matches!(e, UiEvent::Status(Status::Stopped))));\n    assert!(gone < position(|e| matches!(e, UiEvent::Exit)));\n    assert_eq!(seen.iter().filter(|e| matches!(e, UiEvent::ServerGone)).count(), 1);\n    // It went through stdin, not the 30 s kill deadline.
    assert!(asked.elapsed() < Duration::from_secs(10));
    assert!(supervisor.diagnostics(&[]).contains("stdin closed"));
    let _ = fs::remove_dir_all(dir);
}

fn sha256_hex(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn the_master_key_is_the_second_stdin_line_and_never_reaches_the_diagnostics() {
    let Some(s) = start_with("key", "ok", MemoryStore::default(), |_| {}) else {
        return;
    };
    wait_for(&s.rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Status(Status::Ready))
    });
    // First run: a key was generated and kept in the store.
    let stored = s.store.entry().expect("the key was stored");
    assert_eq!(stored.len(), master_key::KEY_BYTES);
    let line = base64url(&stored);
    let text = s.supervisor.diagnostics(&["Mawl test".into()]);
    assert!(text.contains(r#""keyLength":43"#), "{text}");
    assert!(
        text.contains(&format!(r#""keySha256":"{}""#, sha256_hex(&line))),
        "the server got another key:\n{text}"
    );
    assert!(text.contains("warning: key=[redacted]"));
    assert!(text.contains("new master key created"));
    assert!(!text.contains(&line), "master key leaked:\n{text}");
    assert!(!text.contains(s.token.expose()));
    s.supervisor.stop();
    wait_for(&s.rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Exit)
    });
    let _ = fs::remove_dir_all(s.dir);
}

#[test]
fn an_old_key_file_is_imported_into_the_store_and_sent_to_the_server() {
    let old: Vec<u8> = (100..132).collect();
    let Some(s) = start_with("import", "ok", MemoryStore::default(), |dir| {
        let file = master_key::key_file(dir);
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(file, (100..132).collect::<Vec<u8>>()).unwrap();
    }) else {
        return;
    };
    wait_for(&s.rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Status(Status::Ready))
    });
    assert_eq!(s.store.entry().as_deref(), Some(old.as_slice()));
    let text = s.supervisor.diagnostics(&[]);
    assert!(text.contains(&sha256_hex(&base64url(&old))), "{text}");
    assert!(text.contains("copied from secrets\\master.key"));
    // Only the server deletes it, after a decrypt proved the key.
    assert!(master_key::key_file(&s.dir).exists());
    s.supervisor.stop();
    wait_for(&s.rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Exit)
    });
    let _ = fs::remove_dir_all(s.dir);
}

#[test]
fn a_failing_key_store_fails_the_spawn_and_is_retried_without_a_server() {
    let store = MemoryStore::failing(std::io::ErrorKind::PermissionDenied);
    let Some(s) = start_with("keyfail", "ok", store, |_| {}) else {
        return;
    };
    wait_for(&s.rx, Duration::from_secs(10), |e| {
        matches!(
            e,
            UiEvent::Status(Status::Restarting {
                reason: Failure::SpawnFailed,
                ..
            })
        )
    });
    let text = s.supervisor.diagnostics(&[]);
    assert!(text.contains("cannot get the master key"), "{text}");
    assert!(!text.contains("server started"), "{text}");
    s.supervisor.stop();
    wait_for(&s.rx, Duration::from_secs(20), |e| {
        matches!(e, UiEvent::Exit)
    });
    let _ = fs::remove_dir_all(s.dir);
}

#[test]
fn a_crash_is_restarted_after_a_backoff() {
    let Some((supervisor, rx, _token, dir)) = start("crash", "crash-once") else {
        return;
    };
    let seen = wait_for(&rx, Duration::from_secs(30), |e| {
        matches!(e, UiEvent::Status(Status::Ready))
    });
    assert!(seen.iter().any(|e| matches!(
        e,
        UiEvent::Status(Status::Restarting {
            attempt: 1,
            reason: Failure::Exited { code: Some(3) },
            ..
        })
    )));
    assert!(supervisor
        .diagnostics(&[])
        .contains("server exited with code 3"));
    supervisor.stop();
    wait_for(&rx, Duration::from_secs(20), |e| matches!(e, UiEvent::Exit));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn a_missing_install_fails_without_restarting() {
    let dir = data_dir("missing", "ok");
    let (tx, rx) = mpsc::channel();
    let supervisor = Supervisor::start(
        SupervisorConfig {
            command: Err(mawl_host::launch::LaunchError::Missing(PathBuf::from(
                r"C:\Mawl\mawl-server.exe",
            ))),
            data_dir: dir.clone(),
            host_env: Vec::new(),
            port: 1,
            fixed_port: true,
            token: LaunchToken::generate().unwrap(),
            key_store: Arc::new(MemoryStore::default()),
        },
        TestUi(Mutex::new(tx)),
    );
    wait_for(&rx, Duration::from_secs(5), |e| {
        matches!(
            e,
            UiEvent::Status(Status::Failed {
                reason: Failure::NotInstalled
            })
        )
    });
    assert!(supervisor.diagnostics(&[]).contains("mawl-server.exe"));
    let _ = fs::remove_dir_all(dir);
}

#[cfg(windows)]
#[test]
fn killing_the_server_ends_everything_it_started() {
    let Some(node) = node() else {
        eprintln!("skipped: node is not on PATH");
        return;
    };
    let dir = data_dir("job", "grandchild");
    let port = port::choose_port(None, |_| false).unwrap();
    let env = vec![
        ("MAWL_PORT".to_string(), port.to_string()),
        (
            "SystemRoot".to_string(),
            std::env::var("SystemRoot").unwrap_or_default(),
        ),
    ];
    let token = LaunchToken::generate().unwrap();
    let (key, _) = master_key::resolve(&MemoryStore::default(), &dir).unwrap();
    let command = ServerCommand {
        program: node,
        script: fixture(),
        pg_root: None,
        web_dir: None,
        dev: false,
    };
    let process = ServerProcess::spawn(&command, &env, &dir, &token, &key).unwrap();
    let exited = Arc::new(Mutex::new(None));
    let slot = Arc::clone(&exited);
    process.watch_exit(move |code| *slot.lock().unwrap() = Some(code));

    let file = dir.join("grandchild-port");
    let deadline = Instant::now() + Duration::from_secs(15);
    let grandchild_port = loop {
        if let Some(p) = fs::read_to_string(&file)
            .ok()
            .and_then(|t| port::parse_port(&t))
        {
            break p;
        }
        assert!(Instant::now() < deadline, "the grandchild never started");
        std::thread::sleep(Duration::from_millis(50));
    };
    assert!(!port::is_free(grandchild_port));

    process.kill();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !port::is_free(grandchild_port) || exited.lock().unwrap().is_none() {
        assert!(
            Instant::now() < deadline,
            "the process tree outlived the kill"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    drop(process);
    let _ = fs::remove_dir_all(dir);
}
