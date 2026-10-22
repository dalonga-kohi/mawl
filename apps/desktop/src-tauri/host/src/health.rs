//! `GET /healthz` on the loopback server, over a plain TCP socket (no HTTP client dependency).
//! `/healthz` needs no token; the Host header is the loopback address, which the server allows.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

use crate::machine::Health;

pub const PROBE_TIMEOUT: Duration = Duration::from_secs(3);

/// One probe. 200 is [`Health::Ok`], any other status [`Health::Unhealthy`], and anything that
/// is not an HTTP answer in time [`Health::Unreachable`].
pub fn probe(port: u16, timeout: Duration) -> Health {
    match status_of(port, timeout) {
        Some(200) => Health::Ok,
        Some(_) => Health::Unhealthy,
        None => Health::Unreachable,
    }
}

fn status_of(port: u16, timeout: Duration) -> Option<u16> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, timeout).ok()?;
    stream.set_read_timeout(Some(timeout)).ok()?;
    stream.set_write_timeout(Some(timeout)).ok()?;
    let request = format!(
        "GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut head = [0u8; 64];
    let mut read = 0;
    // The status line fits in the first bytes; stop once it is complete.
    while read < head.len() {
        let n = stream.read(&mut head[read..]).ok()?;
        if n == 0 {
            break;
        }
        read += n;
        if head[..read].contains(&b'\n') {
            break;
        }
    }
    parse_status_line(&head[..read])
}

/// The status code of `HTTP/1.x NNN ...`, or `None`.
pub fn parse_status_line(bytes: &[u8]) -> Option<u16> {
    let line = std::str::from_utf8(bytes).ok()?.lines().next()?;
    let mut parts = line.split(' ');
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

    /// Serves one connection with `response` and returns the request it read.
    fn serve_once(response: &'static str) -> (u16, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let n = socket.read(&mut buf).unwrap();
            socket.write_all(response.as_bytes()).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        (port, handle)
    }

    #[test]
    fn a_200_is_ok_and_the_request_names_the_loopback_host() {
        let (port, server) =
            serve_once("HTTP/1.1 200 OK\r\ncontent-length: 11\r\n\r\n{\"ok\":true}");
        assert_eq!(probe(port, PROBE_TIMEOUT), Health::Ok);
        let request = server.join().unwrap();
        assert!(request.starts_with("GET /healthz HTTP/1.1\r\n"));
        assert!(request.contains(&format!("Host: 127.0.0.1:{port}\r\n")));
        assert!(!request.to_ascii_lowercase().contains("authorization"));
    }

    #[test]
    fn a_503_is_unhealthy() {
        let (port, server) = serve_once("HTTP/1.1 503 Service Unavailable\r\n\r\n");
        assert_eq!(probe(port, PROBE_TIMEOUT), Health::Unhealthy);
        server.join().unwrap();
    }

    #[test]
    fn a_closed_port_is_unreachable() {
        let port = {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.local_addr().unwrap().port()
        };
        assert_eq!(probe(port, Duration::from_millis(500)), Health::Unreachable);
    }

    #[test]
    fn a_silent_server_times_out_as_unreachable() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let hold = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            thread::sleep(Duration::from_millis(600));
            drop(socket);
        });
        assert_eq!(probe(port, Duration::from_millis(200)), Health::Unreachable);
        hold.join().unwrap();
    }
}
