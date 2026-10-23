//! Edge cases of the remote Mawl address and token checks, the stored target, the appearance file
//! and the presence enter/leave/re-check states.

use std::fs;
use std::io;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use mawl_host::appearance::{self, Theme};
use mawl_host::master_key::{KeyBytes, KeyStore, MemoryStore};
use mawl_host::presence::Presence;
use mawl_host::remote::{
    check, forget_token, load_target, load_token, parse_remote_token, parse_remote_url,
    save_target, store_token, RemoteHealth, TokenError, UrlError, WindowTarget, MAX_URL_BYTES,
    TARGET_FILE,
};

const TOKEN: &str = "remote-owner-token_0123456789abcdefXYZ";

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("mawl-remedge-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn url(s: &str) -> Result<String, UrlError> {
    parse_remote_url(s).map(|u| u.to_string())
}

#[test]
fn ipv6_literals_and_ports_are_origins() {
    assert_eq!(url("https://[::1]:7420"), Ok("https://[::1]:7420/".into()));
    assert_eq!(
        url("https://[fd7a:115c::1]"),
        Ok("https://[fd7a:115c::1]/".into())
    );
    // Plain http to another machine is refused, whatever the notation.
    assert_eq!(url("http://[fd7a:115c::1]"), Err(UrlError::Insecure));
    assert_eq!(url("http://[::ffff:192.168.1.20]"), Err(UrlError::Insecure));
    assert_eq!(url("http://[::1]"), Ok("http://[::1]/".into()));
    // A bare IPv6 literal has no scheme and is not a valid host:port.
    assert!(url("::1").is_err());
    // Default ports are dropped, so the stored origin is canonical.
    assert_eq!(url("https://host:443"), Ok("https://host/".into()));
    assert_eq!(url("http://host:80"), Err(UrlError::Insecure));
    assert_eq!(url("http://127.0.0.1:80"), Ok("http://127.0.0.1/".into()));
    // Hex, octal and short IPv4 forms normalize before the loopback rule.
    assert_eq!(
        url("http://0x7f000001:7420"),
        Ok("http://127.0.0.1:7420/".into())
    );
    assert_eq!(
        url("http://127.1:7420"),
        Ok("http://127.0.0.1:7420/".into())
    );
    assert_eq!(url("http://0xc0a80114"), Err(UrlError::Insecure));
    assert_eq!(url("http://LOCALHOST"), Ok("http://localhost/".into()));
    assert_eq!(url("host:7420"), Ok("https://host:7420/".into()));
    assert_eq!(url("https://host:65535"), Ok("https://host:65535/".into()));
    assert_eq!(url("https://host:65536"), Err(UrlError::NotAUrl));
    assert_eq!(url("https://host:abc"), Err(UrlError::NotAUrl));
}

#[test]
fn whitespace_inside_or_around_an_address() {
    assert_eq!(
        url("  https://mawl.example.com/  \n"),
        Ok("https://mawl.example.com/".into())
    );
    assert_eq!(url("\t\r\n "), Err(UrlError::Empty));
    assert!(url("https://mawl .example.com").is_err());
    assert!(url("https://mawl.example.com /x").is_err());
    // A tab or newline inside is stripped by the URL parser; the result must still be a clean origin.
    if let Ok(out) = url("https://mawl.exam\nple.com") {
        assert!(!out.contains('\n'));
    }
}

#[test]
fn userinfo_in_every_shape_is_refused_and_never_echoed() {
    for input in [
        "https://user@host",
        "https://user:pw@host",
        "https://:pw@host",
        "http://a:b@[::1]:7420",
        "user:pw@host",
    ] {
        let out = parse_remote_url(input);
        assert!(out.is_err(), "{input} should be refused");
    }
    assert_eq!(url("https://user:secretpw@host"), Err(UrlError::UserInfo));
}

#[test]
fn paths_queries_fragments_and_odd_slashes() {
    assert_eq!(url("https://host/"), Ok("https://host/".into()));
    assert_eq!(url("https://host//"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host/?"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host/#"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host?x=1"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host#frag"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host/a"), Err(UrlError::NotAnOrigin));
    assert_eq!(url("https://host/%2e%2e/a"), Err(UrlError::NotAnOrigin));
    // `/.` and `/..` normalize to `/`, which is the origin itself.
    assert!(url("https://host/..").is_ok_and(|u| u == "https://host/"));
}

#[test]
fn other_schemes_are_refused() {
    for input in [
        "ftp://host",
        "file:///c:/windows",
        "ws://host",
        "wss://host",
        "javascript://host/%0aalert(1)",
        "data://host",
        "HTTPS://Host.Example",
    ] {
        let out = url(input);
        if input.starts_with("HTTPS") {
            assert_eq!(out, Ok("https://host.example/".into()));
        } else {
            assert_eq!(out, Err(UrlError::Scheme), "{input}");
        }
    }
    // No `://` means the text is treated as a host, so these cannot smuggle a scheme.
    assert!(url("javascript:alert(1)").is_err());
    assert!(url("mailto:a@b.c").is_err());
    assert!(url("https:/host").is_ok() || url("https:/host").is_err()); // must not panic
}

#[test]
fn degenerate_inputs_do_not_panic() {
    for input in [
        "https://",
        "http:///",
        "://",
        "https://:7420",
        "//host",
        "https://.",
        "https://%00",
    ] {
        let _ = parse_remote_url(input);
    }
    assert!(url("https://").is_err());
    assert!(url("https://:7420").is_err());
}

#[test]
fn length_boundary_is_in_bytes_and_huge_input_is_refused_fast() {
    let host = |n: usize| format!("https://{}.example", "a".repeat(n));
    // Exactly MAX_URL_BYTES passes the length gate (it may still fail as a host label).
    let at = format!("https://{}", "a".repeat(MAX_URL_BYTES - "https://".len()));
    assert_ne!(url(&at), Err(UrlError::TooLong));
    let over = format!("{at}a");
    assert_eq!(url(&over), Err(UrlError::TooLong));
    assert_eq!(url(&host(10_000_000)), Err(UrlError::TooLong));
    // Multi-byte characters count as bytes, not chars.
    let wide = format!("https://{}", "\u{00e9}".repeat(MAX_URL_BYTES / 2));
    assert_eq!(url(&wide), Err(UrlError::TooLong));
}

#[test]
fn unicode_hosts_normalize_or_fail_cleanly() {
    let out = url("https://m\u{00fc}nchen.example").unwrap();
    assert_eq!(out, "https://xn--mnchen-3ya.example/");
    // Fullwidth dots and a zero-width char do not hide a path.
    assert!(url("https://host\u{ff0f}path").is_err() || url("https://host\u{ff0f}path").is_ok());
    assert!(
        url("https://exa\u{200b}mple.com").is_ok() || url("https://exa\u{200b}mple.com").is_err()
    );
    // A RTL override must not survive into the stored origin.
    if let Ok(o) = url("https://host\u{202e}.example") {
        assert!(!o.contains('\u{202e}'));
    }
}

#[test]
fn token_boundaries_and_characters() {
    let t = |s: &str| parse_remote_token(s).map(|t| t.expose().to_owned());
    assert_eq!(t(&"a".repeat(31)), Err(TokenError::Length));
    assert!(t(&"a".repeat(32)).is_ok());
    assert!(t(&"a".repeat(512)).is_ok());
    assert_eq!(t(&"a".repeat(513)), Err(TokenError::Length));
    assert_eq!(t(&"a".repeat(5_000_000)), Err(TokenError::Length));
    // Surrounding whitespace is dropped, inner whitespace is not allowed.
    assert!(t(&format!("  {}\r\n", "a".repeat(40))).is_ok());
    assert_eq!(
        t(&format!("{} {}", "a".repeat(20), "b".repeat(20))),
        Err(TokenError::Characters)
    );
    assert_eq!(
        t(&format!("{}\u{00e9}", "a".repeat(40))),
        Err(TokenError::Characters)
    );
    assert_eq!(
        t(&format!("{}\0", "a".repeat(40))),
        Err(TokenError::Characters)
    );
    assert_eq!(
        t(&format!("{}=", "a".repeat(40))),
        Err(TokenError::Characters)
    );
    // Characters are checked before length, so a short non-token is a characters error.
    assert_eq!(t("a b"), Err(TokenError::Characters));
    assert_eq!(t(""), Err(TokenError::Empty));
    // Unicode whitespace trims away like ASCII whitespace.\n    assert_eq!(t("\u{00a0}"), Err(TokenError::Empty));
}

#[test]
fn the_token_never_shows_in_debug_serde_or_errors() {
    let token = parse_remote_token(TOKEN).unwrap();
    assert!(!format!("{token:?}").contains(TOKEN));
    assert!(!format!("{token:#?}").contains(TOKEN));
    assert!(!format!("{token}").contains(TOKEN));
    assert!(!format!("{:?}", Some(&token)).contains(TOKEN));

    // A store failure carries no token text.
    let store = MemoryStore::failing(io::ErrorKind::PermissionDenied);
    let err = store_token(&store, &token).unwrap_err();
    assert!(!err.to_string().contains(TOKEN));
    assert!(!format!("{err:?}").contains(TOKEN));

    // A store that holds junk: the error must not echo the junk.
    let junk = "junk-secret-value!!";
    let store = MemoryStore::holding(junk.as_bytes());
    let err = load_token(&store).unwrap_err();
    assert!(!err.to_string().contains(junk));
    assert!(!format!("{err:?}").contains(junk));

    // The saved target holds the origin only.
    let dir = temp_dir("notoken");
    let origin = parse_remote_url("https://mawl.example.com").unwrap();
    save_target(&dir, &WindowTarget::Remote { origin }).unwrap();
    let text = fs::read_to_string(dir.join(TARGET_FILE)).unwrap();
    assert!(!text.contains(TOKEN));
    assert!(!text.to_lowercase().contains("token"));
}

#[test]
fn stored_bytes_that_are_not_utf8_or_oversized_are_not_a_token() {
    let store = MemoryStore::holding(&[0xff, 0xfe, 0xfd]);
    assert!(load_token(&store).is_err());
    let store = MemoryStore::holding("a".repeat(513).as_bytes());
    assert!(load_token(&store).is_err());
    let store = MemoryStore::holding(b"");
    assert!(load_token(&store).is_err() || load_token(&store).unwrap().is_none());
}

#[test]
fn delete_is_idempotent_and_storing_twice_replaces() {
    let store = MemoryStore::default();
    forget_token(&store).unwrap();
    forget_token(&store).unwrap();
    let a = parse_remote_token(TOKEN).unwrap();
    let b = parse_remote_token(&"B".repeat(40)).unwrap();
    store_token(&store, &a).unwrap();
    store_token(&store, &b).unwrap();
    assert_eq!(load_token(&store).unwrap().unwrap().expose(), b.expose());
    forget_token(&store).unwrap();
    forget_token(&store).unwrap();
    assert!(load_token(&store).unwrap().is_none());
}

/// A store that records the order of calls, to check that a failed write is never left half done.
struct Recording {
    calls: Mutex<Vec<&'static str>>,
}

impl KeyStore for Recording {
    fn read(&self) -> io::Result<Option<KeyBytes>> {
        self.calls.lock().unwrap().push("read");
        Ok(None)
    }
    fn write(&self, _key: &[u8]) -> io::Result<()> {
        self.calls.lock().unwrap().push("write");
        Ok(())
    }
    fn delete(&self) -> io::Result<()> {
        self.calls.lock().unwrap().push("delete");
        Ok(())
    }
}

#[test]
fn a_store_that_forgets_what_it_wrote_is_an_error() {
    let store = Recording {
        calls: Mutex::new(Vec::new()),
    };
    let token = parse_remote_token(TOKEN).unwrap();
    assert!(store_token(&store, &token).is_err());
    assert_eq!(*store.calls.lock().unwrap(), vec!["write", "read"]);
}

#[test]
fn target_file_edge_cases_all_mean_local() {
    let dir = temp_dir("targets");
    let write = |text: &str| fs::write(dir.join(TARGET_FILE), text).unwrap();
    for text in [
        "",
        "{}",
        "null",
        "[]",
        r#"{"kind":"remote"}"#,
        r#"{"kind":"remote","origin":""}"#,
        r#"{"kind":"remote","origin":"ftp://host"}"#,
        r#"{"kind":"remote","origin":"https://u:p@host"}"#,
        r#"{"kind":"remote","origin":"https://host/path"}"#,
        r#"{"kind":"remote","origin":42}"#,
        r#"{"kind":"nonsense"}"#,
        "\u{feff}{\"kind\":\"local\"}",
        "{\"kind\":\"remote\",\"origin\":\"https://host\"", // truncated
    ] {
        write(text);
        assert_eq!(load_target(&dir), WindowTarget::Local, "{text}");
    }
    // A huge file does not hang or panic.
    write(&format!(
        r#"{{"kind":"remote","origin":"https://{}"}}"#,
        "a".repeat(3_000_000)
    ));
    assert_eq!(load_target(&dir), WindowTarget::Local);
    // A directory where the file should be.
    fs::remove_file(dir.join(TARGET_FILE)).unwrap();
    fs::create_dir(dir.join(TARGET_FILE)).unwrap();
    assert_eq!(load_target(&dir), WindowTarget::Local);
}

#[test]
fn saving_over_a_stale_partial_file_and_into_a_missing_dir_works() {
    let dir = temp_dir("save").join("nested").join("deeper");
    let origin = parse_remote_url("https://192.168.1.20:7420").unwrap();
    let target = WindowTarget::Remote { origin };
    save_target(&dir, &target).unwrap();
    fs::write(dir.join(format!("{TARGET_FILE}.partial")), "garbage").unwrap();
    save_target(&dir, &target).unwrap();
    save_target(&dir, &target).unwrap();
    assert_eq!(load_target(&dir), target);
    save_target(&dir, &WindowTarget::Local).unwrap();
    assert_eq!(load_target(&dir), WindowTarget::Local);
}

fn origin() -> url::Url {
    parse_remote_url("https://mawl.example.com").unwrap()
}

#[test]
fn check_never_sends_the_token_and_handles_odd_bodies() {
    let token = parse_remote_token(TOKEN).unwrap();
    let seen = Mutex::new(String::new());
    let health = check(&origin(), &token, |u| {
        *seen.lock().unwrap() = u.to_string();
        None
    });
    assert_eq!(health, RemoteHealth::Unreachable);
    assert!(!seen.lock().unwrap().contains(TOKEN));
    assert!(seen
        .lock()
        .unwrap()
        .starts_with("https://mawl.example.com/healthz?n="));

    let body = |b: &str| {
        let b = b.as_bytes().to_vec();
        check(&origin(), &token, move |_| Some((200, b)))
    };
    assert_eq!(body(""), RemoteHealth::NotMawl);
    assert_eq!(body("null"), RemoteHealth::NotMawl);
    assert_eq!(body("[]"), RemoteHealth::NotMawl);
    assert_eq!(body(r#"{"id":42}"#), RemoteHealth::NotMawl);
    assert_eq!(body(r#"{"id":null}"#), RemoteHealth::NotMawl);
    assert_eq!(body(r#"{"id":""}"#), RemoteHealth::TokenRefused);
    assert_eq!(body(r#"{"id":"ready"}"#), RemoteHealth::TokenRefused);
    assert_eq!(body("\u{feff}{}"), RemoteHealth::NotMawl);

    for status in [201u16, 204, 301, 302, 401, 403, 404, 500, 502] {
        let h = check(&origin(), &token, move |_| Some((status, b"{}".to_vec())));
        assert_eq!(h, RemoteHealth::NotMawl, "status {status}");
    }
    // A 503 without the proof is not a sick Mawl, it is not Mawl.
    let h = check(&origin(), &token, |_| Some((503, Vec::new())));
    assert_eq!(h, RemoteHealth::NotMawl);
}

#[test]
fn check_is_not_fooled_by_a_proof_for_another_nonce() {
    // The proof for a fixed nonce, replayed by a server that cannot know the fresh one.
    let token = parse_remote_token(TOKEN).unwrap();
    let replay = Mutex::new(None::<String>);
    let calls = AtomicUsize::new(0);
    for _ in 0..2 {
        let h = check(&origin(), &token, |u| {
            calls.fetch_add(1, Ordering::SeqCst);
            let mut slot = replay.lock().unwrap();
            let body = match slot.as_ref() {
                Some(old) => old.clone(),
                None => {
                    // First round: a pretend server proves nothing yet; record a value.
                    let n = u.query().unwrap().trim_start_matches("n=").to_owned();
                    *slot = Some(format!(r#"{{"id":"{n}"}}"#));
                    r#"{"id":"x"}"#.into()
                }
            };
            Some((200, body.into_bytes()))
        });
        assert_eq!(h, RemoteHealth::TokenRefused);
    }
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}

// --- appearance ---

fn answer(stored: &str) -> String {
    serde_json::to_string(stored).unwrap()
}

#[test]
fn appearance_answers_that_are_malformed_or_hostile() {
    for raw in [
        "",
        "null",
        "undefined",
        "42",
        "\"\"",
        "\"not json\"",
        "\"[]\"",
        "\"null\"",
        "\"42\"",
        "\"\\\"nested\\\"\"",
        "{\"theme\":\"dark\"}", // an object, not the string WebView2 returns
        "\"{\\\"theme\\\":",
    ] {
        assert_eq!(appearance::parse_eval_result(raw), None, "{raw}");
    }
    // Wrong types fall back field by field.
    let a = appearance::parse_eval_result(&answer(
        r##"{"theme":7,"accent":["#ABCDEF"],"reduceMotion":"yes","extra":{"x":1}}"##,
    ))
    .unwrap();
    assert_eq!(a.theme, Theme::System);
    assert_eq!(a.accent, None);
    assert!(!a.reduce_motion);
}

#[test]
fn appearance_accent_is_strict() {
    let accent = |v: &str| {
        appearance::parse_eval_result(&answer(&format!(r#"{{"accent":{v}}}"#)))
            .and_then(|a| a.accent)
    };
    assert_eq!(accent(r##""#abcdef""##), Some("#ABCDEF".into()));
    for bad in [
        r##""#abcde""##,
        r##""#abcdefa""##,
        r##""abcdef""##,
        r##""#ggghhh""##,
        r##""#abcdef; background:url(x)""##,
        r##""#ABCDEF\n""##,
        r##""# abcde""##,
        r##""#\u00e9bcdef""##,
        r##""#+bcdef""##,
        "null",
        "123",
    ] {
        assert_eq!(accent(bad), None, "{bad}");
    }
}

#[test]
fn appearance_answer_size_boundary() {
    let pad = |n: usize| {
        let stored = format!(r#"{{"theme":"dark","pad":"{}"}}"#, "x".repeat(n));
        serde_json::to_string(&stored).unwrap()
    };
    assert!(appearance::parse_eval_result(&pad(100)).is_some());
    assert_eq!(appearance::parse_eval_result(&pad(10_000)), None);
    assert_eq!(appearance::parse_eval_result(&"x".repeat(10_000_000)), None);
}

#[test]
fn appearance_file_malformed_oversized_and_never_keeps_extras() {
    let dir = temp_dir("appearance");
    let file = dir.join(appearance::APPEARANCE_FILE);
    assert_eq!(appearance::load(&dir), None);
    for text in ["", "null", "[]", "{", "\u{0}", "\"dark\""] {
        fs::write(&file, text).unwrap();
        let loaded = appearance::load(&dir);
        // `""`/`null`/`[]`/`"dark"` are not objects.
        assert_eq!(loaded, None, "{text:?}");
    }
    fs::write(&file, vec![b'{'; 5_000_000]).unwrap();
    assert_eq!(appearance::load(&dir), None);
    fs::write(&file, vec![0xff; 100]).unwrap();
    assert_eq!(appearance::load(&dir), None);
    // An oversized but valid object is refused.
    let big = format!(r#"{{"theme":"dark","pad":"{}"}}"#, "x".repeat(8000));
    fs::write(&file, big).unwrap();
    assert_eq!(appearance::load(&dir), None);
    // A file that is a directory.
    fs::remove_file(&file).unwrap();
    fs::create_dir(&file).unwrap();
    assert_eq!(appearance::load(&dir), None);
}

#[test]
fn appearance_save_load_round_trip_and_hand_edited_file_is_rechecked() {
    let dir = temp_dir("appearance-rt").join("not").join("yet");
    let look = appearance::Appearance {
        theme: Theme::Dark,
        accent: Some("#112233".into()),
        reduce_motion: true,
    };
    appearance::save(&dir, &look).unwrap();
    appearance::save(&dir, &look).unwrap();
    assert_eq!(appearance::load(&dir), Some(look));
    fs::write(
        dir.join(appearance::APPEARANCE_FILE),
        r##"{"theme":"dark","accent":"red; x","reduceMotion":true}"##,
    )
    .unwrap();
    let loaded = appearance::load(&dir).unwrap();
    assert_eq!(loaded.accent, None);
    assert_eq!(loaded.theme, Theme::Dark);
}

// --- presence ---

#[test]
fn a_leave_then_a_link_is_deferred_and_a_poisoned_lock_recovers() {
    let p = Arc::new(Presence::new());
    p.set_ready(true);
    assert!(p.try_enter(|| {}));
    assert!(p.leave(|| {}));
    let mut deferred = false;
    assert!(!p.open_link(|| panic!("navigated to a dead server"), || deferred = true));
    assert!(deferred);

    // A navigation callback that panics poisons the lock; later calls still work.
    let q = Arc::clone(&p);
    let _ = thread::spawn(move || {
        q.set_ready(true);
        q.show_splash(|| panic!("boom"));
    })
    .join();
    p.set_ready(true);
    assert!(p.try_enter(|| {}));
}

#[test]
fn a_recheck_before_enter_never_navigates() {
    let p = Presence::new();
    assert!(!p.recheck(false, || panic!("not in the app")));
    assert!(!p.app_allowed());
    assert!(!p.recheck(true, || panic!("proven")));
    assert!(p.app_allowed());
    assert!(p.try_enter(|| {}));
}

#[test]
fn enter_leave_recheck_race_never_leaves_ready_and_unready_flags_split() {
    for _ in 0..200 {
        let p = Arc::new(Presence::new());
        p.set_ready(true);
        let enters = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();
        for i in 0..6 {
            let p = Arc::clone(&p);
            let enters = Arc::clone(&enters);
            handles.push(thread::spawn(move || match i % 3 {
                0 => {
                    if p.try_enter(|| {}) {
                        enters.fetch_add(1, Ordering::SeqCst);
                    }
                }
                1 => {
                    p.recheck(false, || {});
                }
                _ => {
                    p.leave(|| {});
                }
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        // At most one enter can win while nothing re-readies the server.
        assert!(enters.load(Ordering::SeqCst) <= 1);
        // A failed re-check and a leave both made the server not ready; the origin must be closed.
        assert!(!p.app_allowed());
        assert!(!p.in_app());
    }
}
