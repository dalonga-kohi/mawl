//! The key on the wire and in the log ring: edge cases.

use std::io::{self, Write};

use mawl_host::logs::{LogRing, Source, MAX_LINE_BYTES};
use mawl_host::master_key::{resolve, MasterKey, MemoryStore};
use mawl_host::process::write_secrets;
use mawl_host::token::LaunchToken;

fn fresh_key(tag: &str) -> MasterKey {
    let dir = std::env::temp_dir().join(format!("mawl-wire-{tag}-{}", std::process::id()));
    resolve(&MemoryStore::default(), &dir).unwrap().0
}

/// Accepts at most `n` bytes per call, like a pipe under pressure.
struct Dribble {
    out: Vec<u8>,
    n: usize,
    calls: usize,
}

impl Write for Dribble {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.calls += 1;
        let take = buf.len().min(self.n);
        self.out.extend_from_slice(&buf[..take]);
        Ok(take)
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct Broken;

impl Write for Broken {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

struct FlushFails;

impl Write for FlushFails {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        Ok(buf.len())
    }
    fn flush(&mut self) -> io::Result<()> {
        Err(io::Error::from(io::ErrorKind::BrokenPipe))
    }
}

#[test]
fn the_wire_form_is_exactly_44_plus_44_bytes_with_lf_only() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("shape");
    let mut out = Vec::new();
    write_secrets(&mut out, &token, &key).unwrap();
    assert_eq!(out.len(), 43 + 1 + 43 + 1);
    assert!(!out.contains(&b'\r'));
    assert_eq!(out.iter().filter(|&&b| b == b'\n').count(), 2);
    assert_eq!(out[43], b'\n');
    assert_eq!(out[87], b'\n');
}

#[test]
fn a_short_writing_pipe_still_receives_both_lines_whole() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("dribble");
    let mut pipe = Dribble {
        out: Vec::new(),
        n: 3,
        calls: 0,
    };
    write_secrets(&mut pipe, &token, &key).unwrap();
    assert_eq!(
        String::from_utf8(pipe.out).unwrap(),
        format!("{}\n{}\n", token.expose(), key.expose())
    );
    assert!(pipe.calls > 1);
}

#[test]
fn a_broken_pipe_is_an_error() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("broken");
    let err = write_secrets(&mut Broken, &token, &key).unwrap_err();
    assert_eq!(err.kind(), io::ErrorKind::BrokenPipe);
}

#[test]
fn a_failing_flush_is_an_error() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("flush");
    assert!(write_secrets(&mut FlushFails, &token, &key).is_err());
}

#[test]
fn the_key_is_redacted_when_it_sits_right_next_to_the_token() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("adjacent");
    let mut ring = LogRing::new(token.clone());
    ring.redact_key(&key);
    ring.push(
        Source::Stdout,
        &format!("{}{}", token.expose(), key.expose()),
    );
    let text = ring.diagnostics(&[]);
    assert!(!text.contains(&key.expose()[..8]));
    assert!(!text.contains(&token.expose()[..8]));
}

#[test]
fn a_key_straddling_the_line_cut_is_redacted_before_cutting() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("cut");
    let mut ring = LogRing::new(token);
    ring.redact_key(&key);
    for offset in [1usize, 10, 21, 42] {
        let filler = "y".repeat(MAX_LINE_BYTES - offset);
        ring.push(Source::Stderr, &format!("{filler}{}", key.expose()));
    }
    let text = ring.diagnostics(&[]);
    assert!(!text.contains(&key.expose()[..6]), "{text}");
}

#[test]
fn a_second_key_is_redacted_too_and_the_first_stays_redacted() {
    let token = LaunchToken::generate().unwrap();
    let a = fresh_key("a");
    let b = fresh_key("b");
    let mut ring = LogRing::new(token);
    ring.redact_key(&a);
    ring.redact_key(&b);
    ring.push(Source::Stdout, &format!("{} {}", a.expose(), b.expose()));
    let text = ring.diagnostics(&[format!("h {} {}", a.expose(), b.expose())]);
    assert!(!text.contains(a.expose()));
    assert!(!text.contains(b.expose()));
}

#[test]
fn a_key_with_a_trailing_carriage_return_in_the_output_is_still_redacted() {
    let token = LaunchToken::generate().unwrap();
    let key = fresh_key("crlf");
    let mut ring = LogRing::new(token);
    ring.redact_key(&key);
    ring.push(Source::Stderr, &format!("leak {}\r\n", key.expose()));
    let text = ring.diagnostics(&[]);
    assert!(!text.contains(key.expose()));
    assert!(text.contains("leak [redacted]"));
}
