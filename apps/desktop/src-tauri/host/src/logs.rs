//! The server's recent output, kept for "Copy diagnostics", and the boot stage read from it.
//!
//! The server already censors the launch token and the master key in its own log lines; the ring
//! redacts them again, because stderr (a crash trace, a Node warning) bypasses the server's logger.
//! Redaction only catches a whole secret, so it relies on its callers never splitting one: `process::read_lines`
//! carries the tail of a cut 64 KiB piece into the next piece, and `push` redacts before it cuts
//! a line to [`MAX_LINE_BYTES`].

use std::collections::VecDeque;

use crate::machine::Stage;
use crate::master_key::MasterKey;
use crate::token::LaunchToken;

pub const MAX_LINES: usize = 400;
pub const MAX_LINE_BYTES: usize = 2_048;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    Stdout,
    Stderr,
    /// The host's own notes: spawned, exited, restarting.
    Host,
}

impl Source {
    fn tag(self) -> &'static str {
        match self {
            Source::Stdout => "out",
            Source::Stderr => "err",
            Source::Host => "host",
        }
    }
}

#[derive(Debug)]
pub struct LogRing {
    lines: VecDeque<String>,
    token: LaunchToken,
    /// Master keys the host sent (normally one; a new one is added if the store changed).
    keys: Vec<MasterKey>,
    max_lines: usize,
}

impl LogRing {
    pub fn new(token: LaunchToken) -> Self {
        Self::with_capacity(token, MAX_LINES)
    }

    pub fn with_capacity(token: LaunchToken, max_lines: usize) -> Self {
        Self {
            lines: VecDeque::with_capacity(max_lines.min(MAX_LINES)),
            token,
            keys: Vec::new(),
            max_lines: max_lines.max(1),
        }
    }

    /// Also redacts `key` from now on, in new lines and in the diagnostics header. Call it before
    /// the key is written to a server.
    pub fn redact_key(&mut self, key: &MasterKey) {
        if !self.keys.contains(key) {
            self.keys.push(key.clone());
        }
    }

    fn redact(&self, text: &str) -> String {
        let mut clean = self.token.redact(text);
        for key in &self.keys {
            clean = key.redact(&clean);
        }
        clean
    }

    /// Stores one line: secrets redacted first, then cut to [`MAX_LINE_BYTES`] on a char boundary.
    pub fn push(&mut self, source: Source, line: &str) {
        let clean = self.redact(line.trim_end_matches(['\r', '\n']));
        let mut cut = clean.len().min(MAX_LINE_BYTES);
        while !clean.is_char_boundary(cut) {
            cut -= 1;
        }
        let ellipsis = if cut < clean.len() { "…" } else { "" };
        if self.lines.len() == self.max_lines {
            self.lines.pop_front();
        }
        self.lines
            .push_back(format!("[{}] {}{}", source.tag(), &clean[..cut], ellipsis));
    }

    pub fn lines(&self) -> impl Iterator<Item = &str> {
        self.lines.iter().map(String::as_str)
    }

    /// The text "Copy diagnostics" puts on the clipboard: the header, then the recent output.
    pub fn diagnostics(&self, header: &[String]) -> String {
        let mut out = String::new();
        for line in header {
            out.push_str(&self.redact(line));
            out.push('\n');
        }
        out.push_str("\nRecent server output (oldest first):\n");
        for line in &self.lines {
            out.push_str(line);
            out.push('\n');
        }
        out
    }
}

/// The boot stage a server log line shows, if any. The server logs JSON lines (pino) and these
/// messages are its own: `embedded postgres ready` and `migrations applied` mean the database is
/// up and the rest of the server is starting.
pub fn stage_hint(line: &str) -> Option<Stage> {
    let value: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    match value.get("msg")?.as_str()? {
        "embedded postgres ready" | "migrations applied" => Some(Stage::Server),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ring(max: usize) -> (LogRing, LaunchToken) {
        let token = LaunchToken::generate().unwrap();
        (LogRing::with_capacity(token.clone(), max), token)
    }

    #[test]
    fn keeps_the_newest_lines_only() {
        let (mut r, _) = ring(3);
        for i in 0..5 {
            r.push(Source::Stdout, &format!("line {i}"));
        }
        let lines: Vec<&str> = r.lines().collect();
        assert_eq!(lines, ["[out] line 2", "[out] line 3", "[out] line 4"]);
    }

    #[test]
    fn the_token_never_reaches_the_ring_or_the_diagnostics() {
        let (mut r, token) = ring(10);
        r.push(
            Source::Stderr,
            &format!("Error: bad token {}\r\n", token.expose()),
        );
        r.push(Source::Stdout, token.expose());
        let text = r.diagnostics(&[format!("header {}", token.expose())]);
        assert!(!text.contains(token.expose()));
        assert!(text.contains("[err] Error: bad token [redacted]\n"));
        assert!(text.contains("header [redacted]"));
    }

    #[test]
    fn the_master_key_never_reaches_the_ring_or_the_diagnostics() {
        let (mut r, token) = ring(10);
        let dir = std::env::temp_dir().join("mawl-logs-key-test");
        let (key, _) =
            crate::master_key::resolve(&crate::master_key::MemoryStore::default(), &dir).unwrap();
        r.redact_key(&key);
        r.redact_key(&key);
        r.push(
            Source::Stderr,
            &format!("crash with {} and {}\n", key.expose(), token.expose()),
        );
        let filler = "x".repeat(MAX_LINE_BYTES - 10);
        r.push(Source::Stdout, &format!("{filler}{}", key.expose()));
        let text = r.diagnostics(&[format!("header {}", key.expose())]);
        assert!(!text.contains(key.expose()));
        assert!(!text.contains(&key.expose()[..10]));
        assert!(text.contains("[err] crash with [redacted] and [redacted]\n"));
        assert!(text.contains("header [redacted]"));
    }

    #[test]
    fn a_token_at_the_cut_is_redacted_before_cutting() {
        let (mut r, token) = ring(10);
        let filler = "x".repeat(MAX_LINE_BYTES - 10);
        r.push(Source::Stdout, &format!("{filler}{}", token.expose()));
        let line = r.lines().next().unwrap();
        assert!(!line.contains(&token.expose()[..10]));
    }

    #[test]
    fn long_lines_are_cut_on_a_char_boundary() {
        let (mut r, _) = ring(10);
        r.push(Source::Host, &"é".repeat(MAX_LINE_BYTES));
        let line = r.lines().next().unwrap();
        assert!(line.ends_with('…'));
        assert!(line.len() <= MAX_LINE_BYTES + "[host] ".len() + '…'.len_utf8());
    }

    #[test]
    fn stage_hint_reads_the_servers_own_messages_only() {
        assert_eq!(
            stage_hint(r#"{"level":30,"msg":"embedded postgres ready","port":5}"#),
            Some(Stage::Server)
        );
        assert_eq!(
            stage_hint(r#"{"level":30,"msg":"migrations applied"}"#),
            Some(Stage::Server)
        );
        assert_eq!(stage_hint(r#"{"level":30,"msg":"listening"}"#), None);
        assert_eq!(stage_hint("migrations applied"), None);
        assert_eq!(stage_hint(r#"{"msg":5}"#), None);
        assert_eq!(stage_hint(""), None);
    }
}
