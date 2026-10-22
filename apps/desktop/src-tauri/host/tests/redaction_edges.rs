//! The launch token must not reach "Copy diagnostics" however the server's output is chunked.
//! These run the same path the driver does: `read_lines` on the pipe, then `LogRing::push`.

use std::io::Cursor;
use std::sync::mpsc;
use std::time::Duration;

use mawl_host::logs::{LogRing, Source, MAX_LINE_BYTES};
use mawl_host::master_key::MemoryStore;
use mawl_host::token::LaunchToken;

fn lines_of(bytes: Vec<u8>) -> Vec<String> {
    let (tx, rx) = mpsc::channel();
    mawl_host::process::read_lines(Cursor::new(bytes), move |line| {
        let _ = tx.send(line);
    });
    let mut out = Vec::new();
    while let Ok(line) = rx.recv_timeout(Duration::from_secs(5)) {
        out.push(line);
    }
    out
}

/// Longest run of the token that appears anywhere in `text`.
fn longest_token_run(text: &str, token: &str) -> usize {
    let mut best = 0;
    for start in 0..token.len() {
        let mut len = best + 1;
        while start + len <= token.len() && text.contains(&token[start..start + len]) {
            best = len;
            len += 1;
        }
    }
    best
}

fn diagnostics_of(token: &LaunchToken, lines: Vec<String>) -> String {
    let mut ring = LogRing::new(token.clone());
    for line in lines {
        ring.push(Source::Stderr, &line);
    }
    ring.diagnostics(&["header".to_string()])
}

#[test]
fn a_token_spanning_the_64_kib_read_split_does_not_leak_a_fragment() {
    let token = LaunchToken::generate().unwrap();
    let t = token.expose();
    // read_lines splits at 64 KiB; put the middle of the token on the split.
    let split = 64 * 1024;
    let mut bytes = vec![b'x'; split - 20];
    bytes.extend_from_slice(t.as_bytes());
    bytes.extend_from_slice(b"\nnext line\n");
    let text = diagnostics_of(&token, lines_of(bytes));
    let run = longest_token_run(&text, t);
    assert!(
        run < 8,
        "a {run}-character fragment of the launch token reached the diagnostics"
    );
}

#[test]
fn a_master_key_spanning_the_64_kib_read_split_does_not_leak_a_fragment() {
    let token = LaunchToken::generate().unwrap();
    let dir = std::env::temp_dir().join("mawl-redaction-key-edge");
    let (key, _) = mawl_host::master_key::resolve(&MemoryStore::default(), &dir).unwrap();
    let k = key.expose();
    let split = 64 * 1024;
    let mut bytes = vec![b'x'; split - 20];
    bytes.extend_from_slice(k.as_bytes());
    bytes.extend_from_slice(b"\nnext line\n");
    let mut ring = LogRing::new(token);
    ring.redact_key(&key);
    for line in lines_of(bytes) {
        ring.push(Source::Stderr, &line);
    }
    let text = ring.diagnostics(&["header".to_string()]);
    let run = longest_token_run(&text, k);
    assert!(
        run < 8,
        "a {run}-character fragment of the master key reached the diagnostics"
    );
}

#[test]
fn a_token_split_across_two_pipe_reads_with_a_slow_writer_is_still_one_line() {
    // Not one write: the reader must join them (BufRead does) before redacting.
    let token = LaunchToken::generate().unwrap();
    let t = token.expose();
    let (a, b) = t.split_at(20);
    let bytes = format!("boom {a}{b} end\n").into_bytes();
    let text = diagnostics_of(&token, lines_of(bytes));
    assert!(!text.contains(a));
    assert!(text.contains("boom [redacted] end"));
}

#[test]
fn the_token_after_the_2k_cut_and_the_token_across_it_are_both_gone() {
    let token = LaunchToken::generate().unwrap();
    let t = token.expose();
    for pad in [
        MAX_LINE_BYTES - 21,
        MAX_LINE_BYTES - 1,
        MAX_LINE_BYTES,
        MAX_LINE_BYTES + 5,
    ] {
        let line = format!("{}{t}tail", "y".repeat(pad));
        let text = diagnostics_of(&token, vec![line]);
        assert!(longest_token_run(&text, t) < 8, "pad {pad}");
    }
}

#[test]
fn several_tokens_in_one_line_and_unicode_around_them() {
    let token = LaunchToken::generate().unwrap();
    let t = token.expose();
    let line = format!("é{t}日本{t}{t}🙂\r\n");
    let text = diagnostics_of(&token, vec![line]);
    assert!(!text.contains(t));
    assert!(text.contains("é[redacted]日本[redacted][redacted]🙂\n"));
}

#[test]
fn invalid_utf8_in_the_output_does_not_break_the_ring_or_hide_the_token() {
    let token = LaunchToken::generate().unwrap();
    let mut bytes = vec![0xff, 0xfe, b' '];
    bytes.extend_from_slice(token.expose().as_bytes());
    bytes.push(b'\n');
    let text = diagnostics_of(&token, lines_of(bytes));
    assert!(!text.contains(token.expose()));
    assert!(text.contains("[redacted]"));
}

#[test]
fn the_ring_never_grows_past_its_limit_for_a_flood_of_lines() {
    let token = LaunchToken::generate().unwrap();
    let mut ring = LogRing::new(token);
    for i in 0..5_000 {
        ring.push(Source::Stdout, &format!("line {i}"));
    }
    assert_eq!(ring.lines().count(), mawl_host::logs::MAX_LINES);
    assert_eq!(ring.lines().last(), Some("[out] line 4999"));
    assert_eq!(ring.lines().next(), Some("[out] line 4600"));
}

#[test]
fn an_empty_line_and_a_zero_capacity_ring_are_fine() {
    let token = LaunchToken::generate().unwrap();
    let mut ring = LogRing::with_capacity(token, 0);
    ring.push(Source::Host, "");
    ring.push(Source::Host, "");
    assert_eq!(ring.lines().collect::<Vec<_>>(), ["[host] "]);
}
