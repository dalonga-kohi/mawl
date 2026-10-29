//! The custom title bar's window permissions for the app page.
//!
//! The window has no native title bar (`decorations: false`), so the app page draws one and needs
//! the window's drag, minimize, maximize and close. The app page is a remote origin to Tauri, which
//! the static capabilities never reach (see `acl.test.ts`). Its port is only known at run time, so
//! the host grants this narrow set for that exact origin just before it navigates there. Nothing
//! else of the window, and none of the host's own commands.
//!
//! Grants live for the process: Tauri cannot remove a run-time capability, and each grant adds to
//! the origin's entries, so an origin is granted once (`Granted`). After a server restart on another
//! port the old origin keeps its window-chrome grant, but the navigation rule only lets the window
//! load the current app origin, so no page of the old origin can use it.
//!
//! `add_capability` panics (it does not return an error) on a URL pattern it cannot parse, and the
//! panic would poison the authority's lock. So only plain hosts are granted, and the pattern is
//! parsed first; anything else leaves the title bar inert and never crashes the host.

use std::collections::HashSet;
use std::net::Ipv4Addr;
use std::str::FromStr;
use std::sync::Mutex;

use tauri::ipc::CapabilityBuilder;
use tauri::utils::acl::RemoteUrlPattern;
use tauri::{AppHandle, Manager, Url};

use crate::shell::MAIN_WINDOW;

/// Exactly what the title bar calls, nothing more (pinned by `acl.test.ts`).
const PERMISSIONS: [&str; 9] = [
    "core:window:allow-minimize",
    "core:window:allow-toggle-maximize",
    "core:window:allow-internal-toggle-maximize",
    "core:window:allow-close",
    "core:window:allow-start-dragging",
    "core:window:allow-is-maximized",
    "core:window:allow-is-focused",
    "core:event:allow-listen",
    "core:event:allow-unlisten",
];

/// The origins already granted, so each is granted once.
#[derive(Default)]
pub struct Granted(Mutex<HashSet<String>>);

impl Granted {
    /// True the first time an origin is seen.
    fn first_time(&self, origin: &str) -> bool {
        self.0
            .lock()
            .map(|mut seen| seen.insert(origin.to_owned()))
            .unwrap_or(false)
    }

    /// Forgets an origin whose grant failed, so a later entry tries again.
    fn forget(&self, origin: &str) {
        if let Ok(mut seen) = self.0.lock() {
            seen.remove(origin);
        }
    }
}

/// A plain host: an IPv4 address, or a domain of lowercase letters, digits, dots and hyphens. IPv6
/// and anything with URL-pattern syntax (`* ( ) { } +` ...) gets no grant.
fn plain_host(url: &Url) -> bool {
    if let Some(domain) = url.domain() {
        return !domain.is_empty()
            && domain
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-');
    }
    url.host_str()
        .is_some_and(|host| Ipv4Addr::from_str(host).is_ok())
}

/// The origin to grant, as `scheme://host[:port]`, and the remote pattern for it. `None` for an
/// opaque origin, a host that is not plain, or a pattern Tauri would refuse.
fn grant_origin(url: &Url) -> Option<(String, String)> {
    let origin = url.origin();
    if !origin.is_tuple() || !plain_host(url) {
        return None;
    }
    let origin = origin.ascii_serialization();
    let pattern = format!("{origin}/*");
    RemoteUrlPattern::from_str(&pattern).ok()?;
    Some((origin, pattern))
}

/// Runs `add` with the origin and pattern the first time a grantable URL's origin is seen. If
/// `add` reports failure the origin is forgotten, so a later entry tries again.
fn grant_once(granted: &Granted, url: &Url, add: impl FnOnce(&str, &str) -> bool) {
    let Some((origin, pattern)) = grant_origin(url) else {
        return;
    };
    if granted.first_time(&origin) && !add(&origin, &pattern) {
        granted.forget(&origin);
    }
}

/// Lets the page at `url`'s origin control the main window's chrome, once per origin.
pub fn allow_window_chrome(app: &AppHandle, granted: &Granted, url: &Url) {
    grant_once(granted, url, |origin, pattern| {
        let capability = PERMISSIONS.iter().fold(
            CapabilityBuilder::new(format!("titlebar-{origin}"))
                .local(false)
                .remote(pattern.to_owned())
                .window(MAIN_WINDOW),
            |builder, permission| builder.permission(*permission),
        );
        match app.add_capability(capability) {
            Ok(()) => true,
            Err(e) => {
                eprintln!("mawl: could not allow the title bar for {origin}: {e}");
                false
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).expect("a test url parses")
    }

    #[test]
    fn grants_the_exact_origin_without_path_or_wildcard_host() {
        let (origin, pattern) =
            grant_origin(&url("http://127.0.0.1:7421/t/scout?thread=new")).unwrap();
        assert_eq!(origin, "http://127.0.0.1:7421");
        assert_eq!(pattern, "http://127.0.0.1:7421/*");
    }

    #[test]
    fn grants_a_plain_domain_over_https() {
        let (origin, _) = grant_origin(&url("https://mawl.example.com/")).unwrap();
        assert_eq!(origin, "https://mawl.example.com");
    }

    #[test]
    fn grants_nothing_for_an_opaque_origin() {
        assert_eq!(grant_origin(&url("data:text/plain,hi")), None);
    }

    #[test]
    fn grants_nothing_for_ipv6_or_pattern_characters() {
        for raw in [
            "http://[::1]:7420/",
            "https://[2001:db8::1]/",
            "https://a(b).example.com/",
            "https://a{b}.example.com/",
            "https://a+b.example.com/",
            "https://a*b.example.com/",
        ] {
            assert_eq!(grant_origin(&url(raw)), None, "{raw}");
        }
    }

    #[test]
    fn never_yields_a_pattern_tauri_cannot_parse() {
        for raw in [
            "http://[::1]:7420/",
            "https://a:b@example.com/",
            "https://exa%28mple.com/",
            "http://0x7f.1/",
            "https://münchen.example/",
        ] {
            if let Some((_, pattern)) = grant_origin(&url(raw)) {
                assert!(RemoteUrlPattern::from_str(&pattern).is_ok(), "{raw}");
            }
        }
    }

    #[test]
    fn grants_one_origin_once_however_often_the_app_is_entered() {
        let granted = Granted::default();
        let mut calls = 0;
        for _ in 0..3 {
            grant_once(&granted, &url("http://127.0.0.1:7421/"), |_, _| {
                calls += 1;
                true
            });
        }
        assert_eq!(calls, 1);
        grant_once(&granted, &url("http://127.0.0.1:7422/"), |_, _| {
            calls += 1;
            true
        });
        assert_eq!(calls, 2);
    }

    #[test]
    fn tries_again_after_a_failed_grant() {
        let granted = Granted::default();
        let mut calls = 0;
        for ok in [false, true] {
            grant_once(&granted, &url("http://127.0.0.1:7421/"), |_, _| {
                calls += 1;
                ok
            });
        }
        assert_eq!(calls, 2);
    }

    #[test]
    fn permissions_are_window_chrome_and_event_listening_only() {
        for permission in PERMISSIONS {
            assert!(
                permission.starts_with("core:window:allow-")
                    || permission == "core:event:allow-listen"
                    || permission == "core:event:allow-unlisten",
                "{permission}"
            );
        }
        assert!(!PERMISSIONS
            .iter()
            .any(|p| p.contains("navigate") || p.contains("webview")));
    }
}
