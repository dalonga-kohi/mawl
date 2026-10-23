//! `GET /healthz` on the loopback server, over a plain TCP socket (no HTTP client dependency).
//!
//! A 200 alone does not prove the answer came from our server: another process of the same user
//! could hold the port. So every probe sends a fresh random nonce (`?n=`) and the origin it used
//! (`?o=`), and our server answers with `id` = HMAC-SHA256(key = token, the concatenation of
//! `IDENTITY_DOMAIN`, nonce and origin), base64url. Only a process that knows the token can compute it; the value does not
//! reveal the token, a fresh nonce per probe means an old answer cannot be replayed, and the origin
//! in the MAC means a proof obtained for one origin fails a check for another (a look-alike origin
//! relaying the probe to the real server, `remote.rs`). The server proves only origins it counts
//! as its own (its HostPolicy). `/healthz` stays unauthenticated. Mirrored in
//! `apps/server/src/health-identity.ts`.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use hmac::{Hmac, Mac};
use sha2::Sha256;

use crate::machine::Health;
use crate::token::{base64url, LaunchToken};

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);
/// Domain separation, so this HMAC can never be confused with any other use of the token.
pub const IDENTITY_DOMAIN: &str = "mawl/healthz-identity/v2:";
const NONCE_BYTES: usize = 18;
/// The answer is a small JSON object; anything bigger is not our server.
const MAX_RESPONSE: usize = 4 * 1024;

/// The `id` our server returns for `nonce` asked through `origin` (`scheme://host[:port]`, no
/// trailing slash, as `Url::origin().ascii_serialization()` gives it). The nonce is base64url (no
/// `:`) and the origin starts with `http://` or `https://`, so the two split one way only.
pub fn identity_proof(token: &str, nonce: &str, origin: &str) -> String {
    let mut mac =
        Hmac::<Sha256>::new_from_slice(token.as_bytes()).expect("HMAC takes a key of any length");
    mac.update(IDENTITY_DOMAIN.as_bytes());
    mac.update(nonce.as_bytes());
    mac.update(origin.as_bytes());
    base64url(&mac.finalize().into_bytes())
}

/// The origin the local probe uses: `http://127.0.0.1:<port>`.
pub fn local_origin(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

pub(crate) fn new_nonce() -> Option<String> {
    let mut bytes = [0u8; NONCE_BYTES];
    getrandom::fill(&mut bytes).ok()?;
    Some(base64url(&bytes))
}

/// One probe:
/// - [`Health::Ok`]: 200 with the right `id` for this probe's nonce
/// - [`Health::Foreign`]: 200 without it, so something else holds the port
/// - [`Health::Unhealthy`]: any other HTTP status (503 when the database is gone)
/// - [`Health::Unreachable`]: no HTTP answer in time
pub fn probe(port: u16, timeout: Duration, token: &LaunchToken) -> Health {
    let Some(nonce) = new_nonce() else {
        return Health::Unreachable;
    };
    let Some((status, body)) = fetch(port, &nonce, timeout) else {
        return Health::Unreachable;
    };
    if status != 200 {
        return Health::Unhealthy;
    }
    let expected = identity_proof(token.expose(), &nonce, &local_origin(port));
    let id = serde_json::from_slice::<serde_json::Value>(&body)
        .ok()
        .and_then(|v| v.get("id")?.as_str().map(str::to_owned));
    match id {
        Some(id) if constant_time_eq(id.as_bytes(), expected.as_bytes()) => Health::Ok,
        _ => Health::Foreign,
    }
}

pub(crate) fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

fn fetch(port: u16, nonce: &str, timeout: Duration) -> Option<(u16, Vec<u8>)> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    let request = format!(
        "GET /healthz?n={nonce}&o=http%3A%2F%2F127.0.0.1%3A{port} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                response.extend_from_slice(&chunk[..n]);
                if response.len() > MAX_RESPONSE {
                    return None;
                }
                if complete(&response) {
                    break;
                }
            }
            // A timeout after the whole status line still tells us the status.
            Err(_) if !response.is_empty() => break,
            Err(_) => return None,
        }
    }
    let status = parse_status_line(&response)?;
    Some((status, body_of(&response).to_vec()))
}

fn head_end(response: &[u8]) -> Option<usize> {
    response
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .map(|i| i + 4)
}

/// True once the headers and a `content-length` body have all arrived.
fn complete(response: &[u8]) -> bool {
    let Some(end) = head_end(response) else {
        return false;
    };
    let head = String::from_utf8_lossy(&response[..end]).to_ascii_lowercase();
    let length = head
        .lines()
        .find_map(|l| l.strip_prefix("content-length:"))
        .and_then(|v| v.trim().parse::<usize>().ok());
    length.is_some_and(|len| response.len() >= end + len)
}

fn body_of(response: &[u8]) -> &[u8] {
    head_end(response).map_or(&[], |end| &response[end..])
}

/// The status code of `HTTP/1.x NNN ...`, or `None`.
pub fn parse_status_line(bytes: &[u8]) -> Option<u16> {
    let line = std::str::from_utf8(bytes.split(|b| *b == b'\n').next()?).ok()?;
    let mut parts = line.trim_end_matches('\r').split(' ');
    let version = parts.next()?;
    if !version.starts_with("HTTP/1.") {
        return None;
    }
    let code = parts.next()?;
    if code.len() != 3 {
        return None;
    }
    code.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::thread;

    #[test]
    fn parses_status_lines() {
        assert_eq!(parse_status_line(b"HTTP/1.1 200 OK\r\n"), Some(200));
        assert_eq!(
            parse_status_line(b"HTTP/1.1 503 Service Unavailable\r\nx"),
            Some(503)
        );
        assert_eq!(parse_status_line(b"HTTP/1.0 404"), Some(404));
        assert_eq!(parse_status_line(b"SSH-2.0-OpenSSH"), None);
        assert_eq!(parse_status_line(b"HTTP/1.1 20"), None);
        assert_eq!(parse_status_line(b""), None);
        assert_eq!(parse_status_line(&[0xff, 0xfe]), None);
    }

    #[test]
    fn the_proof_matches_the_servers_node_crypto() {
        // node: createHmac('sha256', token).update(IDENTITY_DOMAIN + nonce + origin).digest('base64url')
        // Same vectors as apps/server/src/health-identity.test.ts.
        let token = "A".repeat(43);
        assert_eq!(IDENTITY_DOMAIN, "mawl/healthz-identity/v2:");
        assert_eq!(
            identity_proof(&token, "nonce-0123456789abcdef", "http://127.0.0.1:7420"),
            "_ZIk-YGbotCsazOcJxgmrUUZ9XJH-P3cXYvWhQlsrGI"
        );
        assert_eq!(
            identity_proof(&token, "nonce-0123456789abcdef", "https://mawl.example.com"),
            "iro1oJSCGdnqUbZvjwbm84bkG0LGESNudAbimurco-c"
        );
        // The proof is not the token and changes with the nonce and with the origin.
        let o = "http://127.0.0.1:1";
        assert!(!identity_proof(&token, "x", o).contains(&token));
        assert_ne!(
            identity_proof(&token, "a", o),
            identity_proof(&token, "b", o)
        );
        assert_ne!(
            identity_proof(&token, "a", o),
            identity_proof(&token, "a", "http://127.0.0.1:2")
        );
    }

    #[test]
    fn the_local_origin_is_the_loopback_port() {
        assert_eq!(local_origin(47_420), "http://127.0.0.1:47420");
    }

    /// Serves one connection: `respond(request)` builds the response from the request line.
    fn serve_once(
        respond: impl FnOnce(&str) -> String + Send + 'static,
    ) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let n = socket.read(&mut buf).unwrap();
            let request = String::from_utf8_lossy(&buf[..n]).into_owned();
            socket.write_all(respond(&request).as_bytes()).unwrap();
            request
        });
        (port, handle)
    }

    fn query_of(request: &str, key: &str) -> String {
        let line = request.lines().next().unwrap();
        let target = line.split(' ').nth(1).unwrap();
        let url = url::Url::parse(&format!("http://x{target}")).unwrap();
        url.query_pairs()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.into_owned())
            .unwrap()
    }

    fn nonce_of(request: &str) -> String {
        query_of(request, "n")
    }

    /// The proof our server gives for this request: its nonce and the origin it names.
    fn proof_for(token: &str, request: &str) -> String {
        identity_proof(token, &nonce_of(request), &query_of(request, "o"))
    }

    fn json(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        )
    }

    #[test]
    fn our_server_answering_with_the_proof_is_ok() {
        let token = LaunchToken::generate().unwrap();
        let key = token.clone();
        let (port, server) = serve_once(move |req| {
            let id = proof_for(key.expose(), req);
            json("200 OK", &format!(r#"{{"ok":true,"id":"{id}"}}"#))
        });
        assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Ok);
        let request = server.join().unwrap();
        assert!(request.starts_with("GET /healthz?n="));
        // The probe names the origin it used, so the proof is bound to it.
        assert_eq!(query_of(&request, "o"), format!("http://127.0.0.1:{port}"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert!(!request.to_ascii_lowercase().contains("authorization"));
        assert!(!request.contains(token.expose()));
        // 18 random bytes, base64url.
        assert_eq!(nonce_of(&request).len(), 24);
    }

    #[test]
    fn a_200_without_the_right_proof_is_someone_else() {
        let token = LaunchToken::generate().unwrap();
        let other = LaunchToken::generate().unwrap();
        for body in [
            r#"{"ok":true}"#.to_string(),
            "not json".to_string(),
            format!(
                r#"{{"ok":true,"id":"{}"}}"#,
                identity_proof(other.expose(), "n", "http://127.0.0.1:1")
            ),
        ] {
            let other = other.clone();
            let (port, server) = serve_once(move |req| {
                // The right construction with the wrong token, for this very nonce.
                if body.contains("\"id\"") {
                    let id = proof_for(other.expose(), req);
                    json("200 OK", &format!(r#"{{"ok":true,"id":"{id}"}}"#))
                } else {
                    json("200 OK", &body)
                }
            });
            assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Foreign);
            server.join().unwrap();
        }
    }

    #[test]
    fn a_replayed_proof_for_another_nonce_is_refused() {
        let token = LaunchToken::generate().unwrap();
        let old = identity_proof(
            token.expose(),
            "an-old-nonce-from-before",
            "http://127.0.0.1:1",
        );
        let (port, server) =
            serve_once(move |_| json("200 OK", &format!(r#"{{"ok":true,"id":"{old}"}}"#)));
        assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Foreign);
        server.join().unwrap();
    }

    #[test]
    fn a_proof_for_another_origin_is_refused() {
        // A relay on another port forwards the nonce, but the real server proves its own origin.
        let token = LaunchToken::generate().unwrap();
        let key = token.clone();
        let (port, server) = serve_once(move |req| {
            let id = identity_proof(key.expose(), &nonce_of(req), "http://127.0.0.1:1");
            json("200 OK", &format!(r#"{{"ok":true,"id":"{id}"}}"#))
        });
        assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Foreign);
        server.join().unwrap();
    }

    #[test]
    fn a_503_is_unhealthy() {
        let token = LaunchToken::generate().unwrap();
        let (port, server) = serve_once(|_| json("503 Service Unavailable", r#"{"ok":false}"#));
        assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Unhealthy);
        server.join().unwrap();
    }

    #[test]
    fn a_closed_port_is_unreachable() {
        let token = LaunchToken::generate().unwrap();
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        assert_eq!(
            probe(port, Duration::from_millis(500), &token),
            Health::Unreachable
        );
    }

    #[test]
    fn a_silent_server_times_out_as_unreachable() {
        let token = LaunchToken::generate().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let hold = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(600));
            drop(socket);
        });
        assert_eq!(
            probe(port, Duration::from_millis(200), &token),
            Health::Unreachable
        );
        hold.join().unwrap();
    }

    #[test]
    fn an_oversized_answer_counts_as_no_answer() {
        let token = LaunchToken::generate().unwrap();
        let (port, server) = serve_once(|_| json("200 OK", &"x".repeat(10_000)));
        assert_eq!(probe(port, PROBE_TIMEOUT, &token), Health::Unreachable);
        let _ = server.join();
    }
}
