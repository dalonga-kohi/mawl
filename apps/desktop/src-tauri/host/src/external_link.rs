//! Links in the app page that leave the app (a URL in a chat message, `target="_blank"`).
//!
//! The main frame may only show the splash or the app, so the host cancels such a navigation and
//! hands the URL to the default browser instead, but only when it passes [`external_link`], and at
//! most once per [`MIN_GAP_MS`] ([`OpenLimiter`]).
//!
//! Why the rules are this strict: the page's content comes from agents and the web, so every link
//! in it is untrusted. The OS opener runs whatever handles the scheme, so only `http` and `https`
//! go through (never `file:`, `javascript:`, `data:`, `blob:`, `mailto:`, `mawl:` or any custom
//! scheme). A link to this machine is refused whatever its port: `http://127.0.0.1:<other port>`
//! could be another local service (a database admin page, a dev server) that the page was tricked
//! into poking with the owner's browser session. The app's own origin never leaves the webview,
//! because the launch token only exists there. The URL handed to the browser is the link as given
//! and nothing is added to it, so the launch token cannot end up in it.

use url::{Host, Url};

/// Longest URL handed to the browser, in bytes.
pub const MAX_URL_LEN: usize = 2048;
/// Two opens closer together than this are refused.
pub const MIN_GAP_MS: u64 = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalLink {
    /// Cancel the in-webview navigation and open the URL in the browser.
    Open,
    /// Cancel the navigation and do nothing else.
    Block,
}

/// Whether `target` may be opened in the default browser.
pub fn external_link(target: &Url) -> ExternalLink {
    if target.as_str().len() > MAX_URL_LEN
        || !matches!(target.scheme(), "http" | "https")
        || !target.username().is_empty()
        || target.password().is_some()
        || is_local_host(target)
    {
        return ExternalLink::Block;
    }
    ExternalLink::Open
}

/// No host, `localhost` (and `*.localhost`, which includes the splash's `tauri.localhost`), the
/// unspecified address and loopback addresses in any notation `url` normalizes (decimal, hex,
/// IPv4-mapped IPv6).
fn is_local_host(target: &Url) -> bool {
    match target.host() {
        None => true,
        Some(Host::Domain(name)) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            name.is_empty() || name == "localhost" || name.ends_with(".localhost")
        }
        Some(Host::Ipv4(ip)) => ip.is_loopback() || ip.is_unspecified(),
        Some(Host::Ipv6(ip)) => {
            ip.is_loopback()
                || ip.is_unspecified()
                || ip
                    .to_ipv4_mapped()
                    .is_some_and(|v4| v4.is_loopback() || v4.is_unspecified())
        }
    }
}

/// At most one open per [`MIN_GAP_MS`], on a monotonic millisecond clock the caller passes in.
#[derive(Debug, Default)]
pub struct OpenLimiter {
    last_ms: Option<u64>,
}

impl OpenLimiter {
    pub fn new() -> Self {
        Self::default()
    }

    /// True when an open may happen now; the attempt is then counted.
    pub fn allow(&mut self, now_ms: u64) -> bool {
        match self.last_ms {
            Some(last) if now_ms.saturating_sub(last) < MIN_GAP_MS => false,
            _ => {
                self.last_ms = Some(now_ms);
                true
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(s: &str) -> ExternalLink {
        external_link(&Url::parse(s).unwrap())
    }

    #[test]
    fn http_and_https_open() {
        assert_eq!(link("https://example.com/a?b=c#d"), ExternalLink::Open);
        assert_eq!(link("http://example.com"), ExternalLink::Open);
        assert_eq!(link("HTTPS://Example.COM:8443/x"), ExternalLink::Open);
        assert_eq!(link("https://93.184.216.34/"), ExternalLink::Open);
        assert_eq!(link("https://[2001:db8::1]/"), ExternalLink::Open);
    }

    #[test]
    fn every_other_scheme_is_blocked() {
        for u in [
            "mailto:a@b.c",
            "file:///C:/Windows/win.ini",
            "javascript:alert(1)",
            "data:text/html,hi",
            "blob:https://example.com/uuid",
            "tauri://localhost/",
            "mawl://settings",
            "ms-settings:network",
            "ftp://example.com/",
            "ws://example.com/",
            "about:blank",
        ] {
            assert_eq!(link(u), ExternalLink::Block, "{u}");
        }
    }

    #[test]
    fn userinfo_is_blocked() {
        for u in [
            "https://user:pass@example.com/",
            "https://user@example.com/",
            "https://:pass@example.com/",
            "https://example.com@evil.example/",
        ] {
            assert_eq!(link(u), ExternalLink::Block, "{u}");
        }
    }

    #[test]
    fn this_machine_is_blocked_on_any_port_and_in_any_notation() {
        for u in [
            "http://127.0.0.1:47420/",
            "http://127.0.0.1:1/",
            "http://127.0.0.1/",
            "http://127.1.2.3/",
            "http://localhost:5173/",
            "http://LOCALHOST/",
            "http://localhost./",
            "http://app.localhost/",
            "http://tauri.localhost/splash.html",
            "http://[::1]:8080/",
            "http://[::ffff:127.0.0.1]/",
            "http://0.0.0.0:80/",
            "http://[::]/",
            "http://2130706433/",
            "http://0x7f.1/",
            "http://0177.0.0.1/",
        ] {
            assert_eq!(link(u), ExternalLink::Block, "{u}");
        }
    }

    #[test]
    fn a_name_that_merely_contains_localhost_is_a_normal_site() {
        assert_eq!(link("https://notlocalhost.com/"), ExternalLink::Open);
        assert_eq!(link("https://localhost.example.com/"), ExternalLink::Open);
    }

    #[test]
    fn long_urls_are_blocked() {
        let at_cap = format!("https://example.com/{}", "a".repeat(MAX_URL_LEN - 20));
        assert_eq!(at_cap.len(), MAX_URL_LEN);
        assert_eq!(link(&at_cap), ExternalLink::Open);
        assert_eq!(link(&format!("{at_cap}a")), ExternalLink::Block);
    }

    #[test]
    fn the_limiter_allows_one_open_per_gap() {
        let mut l = OpenLimiter::new();
        assert!(l.allow(0));
        assert!(!l.allow(1));
        assert!(!l.allow(MIN_GAP_MS - 1));
        assert!(l.allow(MIN_GAP_MS));
        assert!(!l.allow(MIN_GAP_MS + 1));
        assert!(l.allow(2 * MIN_GAP_MS));
    }

    #[test]
    fn a_refused_attempt_does_not_extend_the_wait() {
        let mut l = OpenLimiter::new();
        assert!(l.allow(1_000));
        // A page that retries every 100 ms still gets through every 500 ms.
        for t in [1_100, 1_200, 1_300, 1_400] {
            assert!(!l.allow(t));
        }
        assert!(l.allow(1_500));
    }

    #[test]
    fn the_first_open_is_allowed_at_time_zero_and_a_clock_going_back_is_safe() {
        let mut l = OpenLimiter::new();
        assert!(l.allow(0));
        assert!(!l.allow(0));
        let mut l = OpenLimiter::new();
        assert!(l.allow(10_000));
        assert!(!l.allow(5));
    }
}
