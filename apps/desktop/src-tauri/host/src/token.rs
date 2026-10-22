//! The per-launch token: 32 bytes from the OS CSPRNG, base64url without padding (43 characters),
//! which satisfies the server's `AUTH_TOKEN_PATTERN` (32-512 of `A-Z a-z 0-9 - _`).
//!
//! The token goes to the server on stdin and to the webview through an initialization script.
//! It never goes into argv, env, a URL or a log line.

use std::fmt;

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
pub const TOKEN_BYTES: usize = 32;
pub const REDACTED: &str = "[redacted]";

/// A launch token. `Debug` and `Display` never print it; use [`LaunchToken::expose`].
#[derive(Clone, PartialEq, Eq)]
pub struct LaunchToken(String);

impl LaunchToken {
    pub fn generate() -> Result<Self, getrandom::Error> {
        let mut bytes = [0u8; TOKEN_BYTES];
        getrandom::fill(&mut bytes)?;
        let token = Self(base64url(&bytes));
        bytes.fill(0);
        Ok(token)
    }

    /// The secret itself, for the stdin line and the initialization script only.
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// `text` with every occurrence of the token replaced by [`REDACTED`].
    pub fn redact(&self, text: &str) -> String {
        text.replace(self.0.as_str(), REDACTED)
    }
}

impl fmt::Debug for LaunchToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("LaunchToken([redacted])")
    }
}

impl fmt::Display for LaunchToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// RFC 4648 §5 base64url, no padding.
pub fn base64url(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            chunk.get(1).copied().unwrap_or(0),
            chunk.get(2).copied().unwrap_or(0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            let index = (n >> (18 - 6 * i)) & 0x3f;
            out.push(ALPHABET[index as usize] as char);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_the_rfc_vectors() {
        // RFC 4648 §10, without padding.
        for (input, expected) in [
            ("", ""),
            ("f", "Zg"),
            ("fo", "Zm8"),
            ("foo", "Zm9v"),
            ("foob", "Zm9vYg"),
            ("fooba", "Zm9vYmE"),
            ("foobar", "Zm9vYmFy"),
        ] {
            assert_eq!(base64url(input.as_bytes()), expected);
        }
        // The two characters that differ from standard base64.
        assert_eq!(base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn a_token_is_43_url_safe_characters_and_differs_each_time() {
        let a = LaunchToken::generate().unwrap();
        let b = LaunchToken::generate().unwrap();
        assert_eq!(a.expose().len(), 43);
        assert!(a
            .expose()
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'));
        assert_ne!(a, b);
    }

    #[test]
    fn debug_and_display_never_show_the_token() {
        let token = LaunchToken::generate().unwrap();
        assert!(!format!("{token:?}").contains(token.expose()));
        assert!(!format!("{token}").contains(token.expose()));
    }

    #[test]
    fn redact_removes_every_occurrence() {
        let token = LaunchToken::generate().unwrap();
        let line = format!("a {t} b {t}", t = token.expose());
        let clean = token.redact(&line);
        assert_eq!(clean, "a [redacted] b [redacted]");
    }
}
