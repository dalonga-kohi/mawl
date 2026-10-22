//! The loopback port of the server.
//!
//! The web app's origin is `http://127.0.0.1:<port>`, and the browser keeps localStorage (theme,
//! accent, layout) per origin. A new random port each launch would reset those, so the host keeps
//! the port it used last (`<data>/desktop-port`) and only moves when that port is taken.

use std::fs;
use std::io;
use std::net::{Ipv4Addr, TcpListener};
use std::path::Path;

/// First choice on a fresh install. Below Windows' dynamic range (49152-65535), so outgoing
/// connections never take it, and apart from the headless default 7420.
pub const DEFAULT_PORT: u16 = 47_420;
pub const PORT_FILE: &str = "desktop-port";

/// True when nothing listens on `127.0.0.1:port` right now.
pub fn is_free(port: u16) -> bool {
    port != 0 && TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok()
}

/// The remembered port when free, else [`DEFAULT_PORT`] when free, else one the OS picks.
pub fn choose_port(remembered: Option<u16>, free: impl Fn(u16) -> bool) -> io::Result<u16> {
    for candidate in remembered.into_iter().chain([DEFAULT_PORT]) {
        if free(candidate) {
            return Ok(candidate);
        }
    }
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
    Ok(listener.local_addr()?.port())
}

pub fn parse_port(text: &str) -> Option<u16> {
    text.trim().parse::<u16>().ok().filter(|p| *p != 0)
}

pub fn read_remembered(data_dir: &Path) -> Option<u16> {
    parse_port(&fs::read_to_string(data_dir.join(PORT_FILE)).ok()?)
}

pub fn remember(data_dir: &Path, port: u16) -> io::Result<()> {
    fs::create_dir_all(data_dir)?;
    fs::write(data_dir.join(PORT_FILE), port.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prefers_the_remembered_port_then_the_default() {
        assert_eq!(choose_port(Some(50_001), |_| true).unwrap(), 50_001);
        assert_eq!(
            choose_port(Some(50_001), |p| p != 50_001).unwrap(),
            DEFAULT_PORT
        );
        assert_eq!(choose_port(None, |_| true).unwrap(), DEFAULT_PORT);
    }

    #[test]
    fn falls_back_to_a_port_the_os_picks() {
        let port = choose_port(Some(50_001), |_| false).unwrap();
        assert_ne!(port, 0);
        assert_ne!(port, DEFAULT_PORT);
    }

    #[test]
    fn a_listening_port_is_not_free() {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!is_free(port));
        drop(listener);
        assert!(is_free(port));
        assert!(!is_free(0));
    }

    #[test]
    fn parses_and_remembers_the_port() {
        assert_eq!(parse_port(" 47420\n"), Some(47_420));
        assert_eq!(parse_port("0"), None);
        assert_eq!(parse_port("70000"), None);
        assert_eq!(parse_port("x"), None);

        let dir = std::env::temp_dir().join(format!("mawl-port-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        assert_eq!(read_remembered(&dir), None);
        remember(&dir, 51_234).unwrap();
        assert_eq!(read_remembered(&dir), Some(51_234));
        fs::remove_dir_all(&dir).unwrap();
    }
}
