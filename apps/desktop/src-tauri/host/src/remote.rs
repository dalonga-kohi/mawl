//! "Connect to a remote Mawl": the window shows a Mawl on another machine (a headless server on
//! the LAN or over Tailscale) instead of the server this PC runs.
//!
//! - [`WindowTarget`] is where the window goes, kept in `<data>/window-target.json`. Only the
//!   origin is stored there; the owner token lives in Windows Credential Manager
//!   ([`TOKEN_CREDENTIAL`]), never in a file, a URL, argv, env or a log line.
//! - [`parse_remote_url`] accepts `https` origins, and plain `http` only to this machine (loopback),
//!   so the token never crosses a network unencrypted: a host, no `user:pass@`, no path, query or
//!   fragment (Mawl serves its app, `/rpc` and `/ws` at the root).
//! - [`check`] asks the remote's `/healthz` with a fresh nonce and the origin it uses, and accepts
//!   the answer only with the identity proof v2 (`health::identity_proof`: an HMAC keyed by the
//!   owner token over the nonce and that origin). The probe itself never sends the token. A ready
//!   answer shows that a server holding the token answered for this very origin: a look-alike origin
//!   that relays the probe to the real Mawl gets a proof for the real origin, which fails here.
//! - What the check does not cover: it runs when the window target is saved, at each start of Mawl
//!   and on the host's periodic re-check while the app is shown, not before every request the app
//!   page makes. Between two checks the page talks to the origin as TLS (or loopback) lets it; a DNS
//!   or IP change in between is caught only by the next check.

use std::fmt;
use std::fs;
use std::io;
use std::path::Path;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

use crate::health::{constant_time_eq, identity_proof, new_nonce};
use crate::master_key::{wipe, KeyStore};
use crate::token::REDACTED;

pub const TARGET_FILE: &str = "window-target.json";
/// The Credential Manager target of the remote's owner token.
pub const TOKEN_CREDENTIAL: &str = "Mawl/remote-token";
pub const MAX_URL_BYTES: usize = 2048;
/// The server's `AUTH_TOKEN_PATTERN`: 32-512 of `A-Z a-z 0-9 - _`.
pub const TOKEN_MIN_CHARS: usize = 32;
pub const TOKEN_MAX_CHARS: usize = 512;
pub const CHECK_TIMEOUT: Duration = Duration::from_secs(5);
/// `/healthz` answers a small JSON object; anything bigger is not Mawl.
const MAX_BODY: u64 = 4 * 1024;

/// Why an address was refused. Each has its own line of copy in the splash.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UrlError {
    Empty,
    TooLong,
    NotAUrl,
    /// Not `http` or `https`.
    Scheme,
    /// Plain `http` to a host that is not this machine.
    Insecure,
    /// `user:pass@host`.
    UserInfo,
    NoHost,
    /// A path, query or fragment: Mawl lives at the root of its origin.
    NotAnOrigin,
}

/// The origin of a remote Mawl, `scheme://host[:port]/`.
pub fn parse_remote_url(input: &str) -> Result<Url, UrlError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(UrlError::Empty);
    }
    if trimmed.len() > MAX_URL_BYTES {
        return Err(UrlError::TooLong);
    }
    // A bare `mawl.example.com` or `host:port` means https.
    let text = if trimmed.contains("://") {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let url = Url::parse(&text).map_err(|_| UrlError::NotAUrl)?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err(UrlError::Scheme);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(UrlError::UserInfo);
    }
    if url.host_str().is_none_or(str::is_empty) {
        return Err(UrlError::NoHost);
    }
    if url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
        return Err(UrlError::NotAnOrigin);
    }
    if url.scheme() == "http" && !is_loopback(&url) {
        return Err(UrlError::Insecure);
    }
    Ok(url)
}

/// `127.0.0.0/8`, `::1`, `localhost` and `*.localhost` (which resolve to this machine only).
fn is_loopback(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        Some(url::Host::Domain(name)) => name == "localhost" || name.ends_with(".localhost"),
        None => false,
    }
}

/// Why a token was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum TokenError {
    Empty,
    /// Shorter than 32 or longer than 512 characters.
    Length,
    /// Something other than `A-Z a-z 0-9 - _`.
    Characters,
}

/// The remote's owner token. `Debug` and `Display` never print it; wiped on drop.
#[derive(Clone, PartialEq, Eq)]
pub struct RemoteToken(String);

impl RemoteToken {
    /// The secret itself, for the initialization script and the credential store only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl Drop for RemoteToken {
    fn drop(&mut self) {
        // SAFETY: zero bytes are valid UTF-8, so the String stays valid until it is freed.
        wipe(unsafe { self.0.as_bytes_mut() });
    }
}

impl fmt::Debug for RemoteToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("RemoteToken([redacted])")
    }
}

impl fmt::Display for RemoteToken {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

/// A pasted token: surrounding whitespace is dropped, the rest must match the server's pattern.
pub fn parse_remote_token(input: &str) -> Result<RemoteToken, TokenError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(TokenError::Empty);
    }
    if !trimmed
        .bytes()
        .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(TokenError::Characters);
    }
    if !(TOKEN_MIN_CHARS..=TOKEN_MAX_CHARS).contains(&trimmed.len()) {
        return Err(TokenError::Length);
    }
    Ok(RemoteToken(trimmed.to_owned()))
}

/// The token as Credential Manager returned it (UTF-8 bytes), checked like a typed one.
pub fn token_from_bytes(bytes: &[u8]) -> Result<RemoteToken, TokenError> {
    let text = std::str::from_utf8(bytes).map_err(|_| TokenError::Characters)?;
    parse_remote_token(text)
}

/// Writes the token to `store` (Credential Manager, target [`TOKEN_CREDENTIAL`]) and reads it back:
/// only an equal read-back counts as stored.
pub fn store_token(store: &dyn KeyStore, token: &RemoteToken) -> io::Result<()> {
    store.write(token.expose().as_bytes())?;
    match load_token(store)? {
        Some(back) if back == *token => Ok(()),
        _ => Err(io::Error::other(
            "the token read back from Windows Credential Manager does not match what was written",
        )),
    }
}

/// The stored token: `None` when there is none, an error when the store fails or holds something
/// that is not a token.
pub fn load_token(store: &dyn KeyStore) -> io::Result<Option<RemoteToken>> {
    let Some(bytes) = store.read()? else {
        return Ok(None);
    };
    token_from_bytes(bytes.as_slice())
        .map(Some)
        .map_err(|_| io::Error::other("the stored remote token is not a valid token"))
}

/// Deletes the stored token; a missing one is fine.
pub fn forget_token(store: &dyn KeyStore) -> io::Result<()> {
    store.delete()
}

/// Where the main window goes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WindowTarget {
    /// The server this PC runs (the supervisor).
    Local,
    /// A Mawl on another machine; this PC runs no server.
    Remote { origin: Url },
}

#[derive(Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StoredTarget {
    Local,
    Remote { origin: String },
}

/// The saved target. A missing, unreadable or invalid file means [`WindowTarget::Local`].
pub fn load_target(data_dir: &Path) -> WindowTarget {
    let Ok(text) = fs::read_to_string(data_dir.join(TARGET_FILE)) else {
        return WindowTarget::Local;
    };
    match serde_json::from_str::<StoredTarget>(&text) {
        Ok(StoredTarget::Remote { origin }) => match parse_remote_url(&origin) {
            Ok(origin) => WindowTarget::Remote { origin },
            Err(_) => WindowTarget::Local,
        },
        Ok(StoredTarget::Local) | Err(_) => WindowTarget::Local,
    }
}

/// Saves the target (write a temporary file, then rename, so a crash never leaves half a file).
pub fn save_target(data_dir: &Path, target: &WindowTarget) -> io::Result<()> {
    let stored = match target {
        WindowTarget::Local => StoredTarget::Local,
        WindowTarget::Remote { origin } => StoredTarget::Remote {
            origin: origin.to_string(),
        },
    };
    let text = serde_json::to_string(&stored).map_err(io::Error::other)?;
    fs::create_dir_all(data_dir)?;
    let partial = data_dir.join(format!("{TARGET_FILE}.partial"));
    fs::write(&partial, text)?;
    fs::rename(&partial, data_dir.join(TARGET_FILE))
}

/// What the remote answered.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RemoteHealth {
    /// Mawl, and it proved it knows this token.
    Ready,
    /// No HTTP answer in time (offline, wrong address, a certificate the OS does not trust).
    Unreachable,
    /// Something answered, but not a Mawl (no proof, not JSON, another status).
    NotMawl,
    /// A Mawl answered with a proof for another token: this token is wrong.
    TokenRefused,
    /// Mawl answered 503 with the proof: it runs but has lost its database.
    Unhealthy,
}

/// One check of `origin` with `token`. `fetch` performs the GET and returns the status and body,
/// or `None` when there was no HTTP answer; [`fetch_once`] is the real one.
pub fn check(
    origin: &Url,
    token: &RemoteToken,
    fetch: impl FnOnce(&Url) -> Option<(u16, Vec<u8>)>,
) -> RemoteHealth {
    let Some(nonce) = new_nonce() else {
        return RemoteHealth::Unreachable;
    };
    // `https://host[:port]`, no trailing slash: the form the server compares and MACs.
    let used = origin.origin().ascii_serialization();
    let Ok(mut url) = origin.join("healthz") else {
        return RemoteHealth::NotMawl;
    };
    url.query_pairs_mut()
        .append_pair("n", &nonce)
        .append_pair("o", &used);
    let Some((status, body)) = fetch(&url) else {
        return RemoteHealth::Unreachable;
    };
    if !matches!(status, 200 | 503) {
        return RemoteHealth::NotMawl;
    }
    let id = serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("id")?.as_str().map(str::to_owned));
    let Some(id) = id else {
        return RemoteHealth::NotMawl;
    };
    let expected = identity_proof(token.expose(), &nonce, &used);
    if !constant_time_eq(id.as_bytes(), expected.as_bytes()) {
        return RemoteHealth::TokenRefused;
    }
    // Only a proven Mawl may say it is sick.
    if status == 200 {
        RemoteHealth::Ready
    } else {
        RemoteHealth::Unhealthy
    }
}

/// One GET over HTTP or HTTPS (the OS's TLS and certificate store), no redirects, no cookies, a
/// small body limit, [`CHECK_TIMEOUT`] in all.
pub fn fetch_once(url: &Url) -> Option<(u16, Vec<u8>)> {
    use ureq::tls::{RootCerts, TlsConfig, TlsProvider};
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(CHECK_TIMEOUT))
        // A redirect is answered as it is (and counts as not Mawl); it is never followed.
        .max_redirects(0)
        .http_status_as_error(false)
        .tls_config(
            TlsConfig::builder()
                .provider(TlsProvider::NativeTls)
                .root_certs(RootCerts::PlatformVerifier)
                .build(),
        )
        .build();
    let agent = ureq::Agent::new_with_config(config);
    let mut response = agent
        .get(url.as_str())
        .header("accept", "application/json")
        .call()
        .ok()?;
    let status = response.status().as_u16();
    let body = response
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_vec()
        .ok()?;
    Some((status, body))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::master_key::MemoryStore;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    const TOKEN: &str = "remote-owner-token_0123456789abcdefXYZ";

    fn token() -> RemoteToken {
        parse_remote_token(TOKEN).unwrap()
    }

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("mawl-remote-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn accepts_https_origins_and_http_on_loopback_and_normalizes_them() {
        let ok = |s: &str| parse_remote_url(s).map(|u| u.to_string());
        assert_eq!(
            ok("https://mawl.tail1234.ts.net"),
            Ok("https://mawl.tail1234.ts.net/".into())
        );
        assert_eq!(
            ok("  https://192.168.1.20:7420/  "),
            Ok("https://192.168.1.20:7420/".into())
        );
        // Plain http only to this machine: the token never crosses a network unencrypted.
        assert_eq!(
            ok("http://127.0.0.1:7420"),
            Ok("http://127.0.0.1:7420/".into())
        );
        assert_eq!(ok("http://127.8.9.10:1"), Ok("http://127.8.9.10:1/".into()));
        assert_eq!(
            ok("http://localhost:7420"),
            Ok("http://localhost:7420/".into())
        );
        assert_eq!(
            ok("http://mawl.localhost:7420"),
            Ok("http://mawl.localhost:7420/".into())
        );
        assert_eq!(ok("http://[::1]:7420"), Ok("http://[::1]:7420/".into()));
        assert_eq!(
            ok("HTTPS://Mawl.Example.COM:443"),
            Ok("https://mawl.example.com/".into())
        );
        // A bare host is taken as https.
        assert_eq!(
            ok("mawl.example.com"),
            Ok("https://mawl.example.com/".into())
        );
        assert_eq!(
            ok("https://[fd7a:115c::1]:7420"),
            Ok("https://[fd7a:115c::1]:7420/".into())
        );
    }

    #[test]
    fn plain_http_to_another_machine_is_refused() {
        for input in [
            "http://192.168.1.20:7420",
            "http://mawl.tail1234.ts.net",
            "HTTP://Mawl.Example.COM",
            "http://[fd7a:115c::1]:7420",
            "http://10.0.0.1",
            "http://0.0.0.0:7420",
            "http://localhost.example.com",
            "http://127.0.0.1.nip.io",
        ] {
            assert_eq!(parse_remote_url(input), Err(UrlError::Insecure), "{input}");
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_plain_web_origin() {
        let err = |s: &str| parse_remote_url(s).unwrap_err();
        assert_eq!(err(""), UrlError::Empty);
        assert_eq!(err("   "), UrlError::Empty);
        assert_eq!(
            err(&format!("https://{}.com", "a".repeat(MAX_URL_BYTES))),
            UrlError::TooLong
        );
        assert_eq!(err("https://"), UrlError::NotAUrl);
        assert_eq!(err("http://exa mple.com"), UrlError::NotAUrl);
        for scheme in [
            "file:///C:/x",
            "ftp://mawl.example.com",
            "ws://mawl.example.com",
            "javascript:alert(1)",
            "data:text/html,hi",
            "mawl://open",
        ] {
            assert!(
                matches!(
                    err(scheme),
                    UrlError::Scheme | UrlError::NotAUrl | UrlError::NoHost
                ),
                "{scheme}"
            );
        }
        assert_eq!(err("ftp://mawl.example.com"), UrlError::Scheme);
        assert_eq!(
            err("https://owner:secret@mawl.example.com"),
            UrlError::UserInfo
        );
        assert_eq!(err("https://owner@mawl.example.com"), UrlError::UserInfo);
        assert_eq!(err("https://mawl.example.com/app"), UrlError::NotAnOrigin);
        assert_eq!(
            err("https://mawl.example.com/?t=abc"),
            UrlError::NotAnOrigin
        );
        assert_eq!(err("https://mawl.example.com/#x"), UrlError::NotAnOrigin);
    }

    #[test]
    fn a_token_must_match_the_servers_pattern() {
        assert_eq!(
            parse_remote_token(&format!("  {TOKEN}\n"))
                .unwrap()
                .expose(),
            TOKEN
        );
        assert_eq!(parse_remote_token(" ").unwrap_err(), TokenError::Empty);
        assert_eq!(
            parse_remote_token(&"a".repeat(31)).unwrap_err(),
            TokenError::Length
        );
        assert!(parse_remote_token(&"a".repeat(32)).is_ok());
        assert!(parse_remote_token(&"a".repeat(512)).is_ok());
        assert_eq!(
            parse_remote_token(&"a".repeat(513)).unwrap_err(),
            TokenError::Length
        );
        assert_eq!(
            parse_remote_token(&format!("{TOKEN}!")).unwrap_err(),
            TokenError::Characters
        );
        assert_eq!(
            parse_remote_token(&format!("{} {}", &TOKEN[..20], &TOKEN[20..])).unwrap_err(),
            TokenError::Characters
        );
        assert_eq!(token_from_bytes(TOKEN.as_bytes()).unwrap().expose(), TOKEN);
        assert_eq!(
            token_from_bytes(&[0xff; 40]).unwrap_err(),
            TokenError::Characters
        );
    }

    #[test]
    fn the_token_is_kept_in_the_store_read_back_and_forgotten() {
        let store = MemoryStore::default();
        assert!(load_token(&store).unwrap().is_none());
        store_token(&store, &token()).unwrap();
        assert_eq!(store.entry().unwrap(), TOKEN.as_bytes());
        assert_eq!(load_token(&store).unwrap().unwrap().expose(), TOKEN);
        forget_token(&store).unwrap();
        assert!(store.entry().is_none());
        assert!(load_token(&store).unwrap().is_none());
        // Forgetting twice is fine.
        forget_token(&store).unwrap();
    }

    #[test]
    fn a_store_that_returns_something_else_is_an_error() {
        let mut store = MemoryStore::default();
        store.corrupt_writes = Some(b"x".repeat(40));
        assert!(store_token(&store, &token()).is_err());
        // A stored value that is not a token reads as an error, not as a token.
        let store = MemoryStore::holding(b"short");
        assert!(load_token(&store).is_err());
        let failing = MemoryStore::failing(io::ErrorKind::PermissionDenied);
        assert!(store_token(&failing, &token()).is_err());
        assert!(load_token(&failing).is_err());
    }

    #[test]
    fn the_token_never_shows_in_debug_or_display() {
        let t = token();
        assert!(!format!("{t:?}").contains(TOKEN));
        assert!(!format!("{t}").contains(TOKEN));
    }

    #[test]
    fn the_target_round_trips_and_a_bad_file_means_local() {
        let dir = temp_dir("target");
        assert_eq!(load_target(&dir), WindowTarget::Local);
        let remote = WindowTarget::Remote {
            origin: parse_remote_url("https://mawl.example.com").unwrap(),
        };
        save_target(&dir, &remote).unwrap();
        assert_eq!(load_target(&dir), remote);
        // Only the origin is written: no token, nothing else.
        let text = fs::read_to_string(dir.join(TARGET_FILE)).unwrap();
        assert_eq!(
            text,
            r#"{"kind":"remote","origin":"https://mawl.example.com/"}"#
        );
        save_target(&dir, &WindowTarget::Local).unwrap();
        assert_eq!(load_target(&dir), WindowTarget::Local);

        for bad in [
            "not json",
            r#"{"kind":"remote"}"#,
            r#"{"kind":"remote","origin":"file:///C:/x"}"#,
            r#"{"kind":"remote","origin":"https://u:p@mawl.example.com"}"#,
            r#"{"kind":"elsewhere"}"#,
        ] {
            fs::write(dir.join(TARGET_FILE), bad).unwrap();
            assert_eq!(load_target(&dir), WindowTarget::Local, "{bad}");
        }
        let _ = fs::remove_dir_all(dir);
    }

    fn origin() -> Url {
        parse_remote_url("https://mawl.example.com").unwrap()
    }

    fn query(url: &Url, key: &str) -> String {
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .unwrap()
    }

    /// A fetch that answers with `body(nonce, origin)`, the nonce and origin the probe sent.
    fn answering(
        status: u16,
        body: impl FnOnce(&str, &str) -> String,
    ) -> impl FnOnce(&Url) -> Option<(u16, Vec<u8>)> {
        move |url: &Url| {
            assert_eq!(url.path(), "/healthz");
            assert_eq!(url.host_str(), Some("mawl.example.com"));
            // The token never travels with the probe.
            assert!(!url.as_str().contains(TOKEN));
            Some((
                status,
                body(&query(url, "n"), &query(url, "o")).into_bytes(),
            ))
        }
    }

    fn proof_body(token: &str, nonce: &str, origin: &str) -> String {
        format!(
            r#"{{"ok":true,"id":"{}"}}"#,
            identity_proof(token, nonce, origin)
        )
    }

    #[test]
    fn the_probe_names_the_origin_it_uses() {
        let seen = std::cell::RefCell::new(None);
        check(&origin(), &token(), |url| {
            *seen.borrow_mut() = Some(url.clone());
            None
        });
        let url = seen.into_inner().unwrap();
        assert_eq!(query(&url, "o"), "https://mawl.example.com");
        assert_eq!(query(&url, "n").len(), 24);
        // A non-default port is part of the origin.
        let seen = std::cell::RefCell::new(None);
        let other = parse_remote_url("https://mawl.example.com:8443").unwrap();
        check(&other, &token(), |url| {
            *seen.borrow_mut() = Some(url.clone());
            None
        });
        assert_eq!(
            query(&seen.into_inner().unwrap(), "o"),
            "https://mawl.example.com:8443"
        );
    }

    #[test]
    fn a_mawl_that_proves_the_token_is_ready() {
        let health = check(
            &origin(),
            &token(),
            answering(200, |n, o| proof_body(TOKEN, n, o)),
        );
        assert_eq!(health, RemoteHealth::Ready);
    }

    #[test]
    fn a_proof_relayed_from_another_origin_means_the_token_is_refused() {
        // A look-alike at `origin()` relays the probe to the real Mawl, which proves only its own
        // origin: the proof is right for the nonce and the token, but for origin A, not B.
        let health = check(
            &origin(),
            &token(),
            answering(200, |n, _| {
                proof_body(TOKEN, n, "https://mawl.tail1234.ts.net")
            }),
        );
        assert_eq!(health, RemoteHealth::TokenRefused);
    }

    #[test]
    fn a_proof_for_another_token_means_the_token_is_wrong() {
        let other = "another-owner-token_0123456789abcdefXYZ";
        let health = check(
            &origin(),
            &token(),
            answering(200, |n, o| proof_body(other, n, o)),
        );
        assert_eq!(health, RemoteHealth::TokenRefused);
        // A replayed proof for an old nonce counts the same.
        let old = proof_body(TOKEN, "an-old-nonce", "https://mawl.example.com");
        let health = check(&origin(), &token(), answering(200, |_, _| old));
        assert_eq!(health, RemoteHealth::TokenRefused);
    }

    #[test]
    fn anything_else_is_not_mawl_unhealthy_or_unreachable() {
        let not_mawl = [
            (200, r#"{"ok":true}"#),
            (200, "<html>hello</html>"),
            (200, r#"{"ok":true,"id":42}"#),
            (404, "not found"),
            (302, ""),
            (401, r#"{"ok":false}"#),
        ];
        for (status, body) in not_mawl {
            let health = check(
                &origin(),
                &token(),
                answering(status, |_, _| body.to_string()),
            );
            assert_eq!(health, RemoteHealth::NotMawl, "{status} {body}");
        }
        // A 503 counts as a sick Mawl only with the proof: an impostor cannot claim one.
        let health = check(
            &origin(),
            &token(),
            answering(503, |n, o| {
                format!(r#"{{"ok":false,"id":"{}"}}"#, identity_proof(TOKEN, n, o))
            }),
        );
        assert_eq!(health, RemoteHealth::Unhealthy);
        let health = check(
            &origin(),
            &token(),
            answering(503, |_, _| r#"{"ok":false}"#.into()),
        );
        assert_eq!(health, RemoteHealth::NotMawl);
        let health = check(
            &origin(),
            &token(),
            answering(503, |n, _| {
                format!(
                    r#"{{"ok":false,"id":"{}"}}"#,
                    identity_proof(TOKEN, n, "https://elsewhere.example")
                )
            }),
        );
        assert_eq!(health, RemoteHealth::TokenRefused);
        assert_eq!(
            check(&origin(), &token(), |_| None),
            RemoteHealth::Unreachable
        );
    }

    /// Serves one connection with `response`; returns the port and the request it saw.
    fn serve_once(response: String) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0u8; 2048];
            let n = socket.read(&mut buf).unwrap();
            socket.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (port, handle)
    }

    #[test]
    fn the_real_fetch_reads_status_and_body_and_sends_no_credentials() {
        let body = r#"{"ok":true}"#;
        let (port, server) = serve_once(format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        ));
        let url = Url::parse(&format!("http://127.0.0.1:{port}/healthz?n=abc")).unwrap();
        assert_eq!(fetch_once(&url), Some((200, body.as_bytes().to_vec())));
        let request = server.join().unwrap().to_ascii_lowercase();
        assert!(request.starts_with("get /healthz?n=abc http/1.1"));
        assert!(!request.contains("authorization"));
        assert!(!request.contains("cookie"));
    }

    #[test]
    fn the_real_fetch_does_not_follow_redirects() {
        let (port, server) = serve_once(
            "HTTP/1.1 302 Found\r\nlocation: http://127.0.0.1:1/elsewhere\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                .to_string(),
        );
        let url = Url::parse(&format!("http://127.0.0.1:{port}/healthz?n=abc")).unwrap();
        assert_eq!(fetch_once(&url).map(|(s, _)| s), Some(302));
        server.join().unwrap();
    }

    #[test]
    fn the_real_fetch_gives_up_on_an_oversized_body_or_a_closed_port() {
        let big = "x".repeat(10_000);
        let (port, server) = serve_once(format!(
            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{big}",
            big.len()
        ));
        let url = Url::parse(&format!("http://127.0.0.1:{port}/healthz")).unwrap();
        assert_eq!(fetch_once(&url), None);
        let _ = server.join();

        let closed = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap().port()
        };
        let url = Url::parse(&format!("http://127.0.0.1:{closed}/healthz")).unwrap();
        assert_eq!(fetch_once(&url), None);
    }
}
