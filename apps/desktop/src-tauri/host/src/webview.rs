//! How the main window treats the launch token and navigation.
//!
//! The window starts on the bundled splash (Tauri's own origin) and moves to the web app the
//! server serves at `http://127.0.0.1:<port>/` once `/healthz` answers with the proof that it is
//! our server (`health::identity_proof`). The token reaches that page through an initialization
//! script, which the webview runs in the main frame only, before any page script. The script only
//! defines the token on the app's origin ([`TokenScope`]), and the navigation handler keeps the
//! main frame on the splash or the app's exact origin. What it does not cover: frames inside the
//! app page get no initialization script (and the server's CSP forbids frames), and pop-ups are
//! refused by the window's `on_new_window` handler, so they never load at all. A remote Mawl's
//! script compares the whole origin, port included. The local script leaves the port out, because
//! the server may move to a new port during a restart and the script is fixed when the window is
//! built; for it the navigation rule pins the port (and the page is on `127.0.0.1`).

use url::Url;

/// `(scheme, host, port)`: an origin that also works for `tauri://localhost`, which `url` treats
/// as opaque.
fn origin(url: &Url) -> Option<(String, String, Option<u16>)> {
    Some((
        url.scheme().to_ascii_lowercase(),
        url.host_str()?.to_ascii_lowercase(),
        url.port_or_known_default(),
    ))
}

pub fn same_origin(a: &Url, b: &Url) -> bool {
    match (origin(a), origin(b)) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

/// Whether the main frame may load `target`. Everything else is refused.
///
/// On the splash's origin only the splash page itself (same path; a query or fragment is fine) is
/// allowed: the rest of the web build is served from the same origin, and that origin has IPC.
/// The app's origin is allowed whole, and callers pass it only while the server is ready.
pub fn allow_navigation(target: &Url, splash: &Url, app: Option<&Url>) -> bool {
    if target.as_str() == "about:blank" {
        return true;
    }
    let is_splash = same_origin(target, splash) && target.path() == splash.path();
    is_splash || app.is_some_and(|app| same_origin(target, app))
}

/// Whether a denied navigation may go on to the browser: never for the app's own origin (a link
/// the app opened while the server was not ready, which belongs in the window, not in a browser).
pub fn open_denied_externally(target: &Url, app: &Url) -> bool {
    !same_origin(target, app)
}

/// Which pages the token script defines the token on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenScope {
    /// The app's exact origin, port included (a remote Mawl: its origin never changes in a run).
    Origin,
    /// The app's scheme and host on any port (this PC's server on `127.0.0.1`, which may move to
    /// another port within a run; the navigation rule pins the current one).
    LoopbackAnyPort,
}

/// The script that defines `window.__MAWL_LAUNCH_TOKEN__` on the app's pages only. Read-only and
/// not enumerable, so a careless `JSON.stringify(window)`-style dump does not carry it.
pub fn launch_token_script(token: &str, app: &Url, scope: TokenScope) -> String {
    let quote = |s: &str| serde_json::to_string(s).expect("a string always serializes");
    let guard = match scope {
        TokenScope::Origin => format!(
            "location.origin !== {}",
            quote(&app.origin().ascii_serialization())
        ),
        TokenScope::LoopbackAnyPort => format!(
            "location.protocol !== {} || location.hostname !== {}",
            quote(&format!("{}:", app.scheme())),
            quote(app.host_str().unwrap_or(""))
        ),
    };
    format!(
        r#"(function () {{
  if (window.top !== window) return;
  if ({guard}) return;
  Object.defineProperty(window, "__MAWL_LAUNCH_TOKEN__", {{
    value: {token},
    writable: false,
    enumerable: false,
    configurable: false
  }});
}})();
"#,
        token = quote(token),
    )
}

/// `http://127.0.0.1:<port>/`.
pub fn app_url(port: u16) -> Url {
    Url::parse(&format!("http://127.0.0.1:{port}/")).expect("a loopback url always parses")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn navigation_stays_on_the_splash_or_the_app() {
        let splash = url("http://tauri.localhost/splash.html");
        let app = app_url(47_420);
        let allow = |t: &str| allow_navigation(&url(t), &splash, Some(&app));
        assert!(allow("http://tauri.localhost/splash.html?x=1"));
        assert!(allow("http://127.0.0.1:47420/t/sam"));
        assert!(allow("about:blank"));
        assert!(!allow("http://127.0.0.1:47421/"));
        assert!(!allow("https://127.0.0.1:47420/"));
        assert!(!allow("http://localhost:47420/"));
        assert!(!allow("https://example.com/"));
        assert!(!allow("data:text/html,hi"));
        assert!(!allow("file:///C:/Windows/win.ini"));
        // Before the server is ready only the splash is allowed.
        assert!(!allow_navigation(
            &url("http://127.0.0.1:47420/"),
            &splash,
            None
        ));
    }

    #[test]
    fn only_the_exact_splash_page_is_allowed_on_the_local_origin() {
        let splash = url("http://tauri.localhost/splash.html");
        let allow = |t: &str| allow_navigation(&url(t), &splash, None);
        // The query is allowed on the exact path; the fragment is not part of the path either.
        assert!(allow("http://tauri.localhost/splash.html"));
        assert!(allow("http://tauri.localhost/splash.html?x=1"));
        assert!(allow("http://tauri.localhost/splash.html#a"));
        // The rest of the web build lives on the same origin and has local-origin IPC.
        assert!(!allow("http://tauri.localhost/index.html"));
        assert!(!allow("http://tauri.localhost/"));
        assert!(!allow("http://tauri.localhost/splash.html/"));
        assert!(!allow("http://tauri.localhost/assets/x.js"));
        assert!(!allow("http://tauri.localhost/%73plash.html/../index.html"));
        // The dev server (Vite) is held to the same rule.
        let dev = url("http://localhost:5173/splash.html");
        assert!(allow_navigation(
            &url("http://localhost:5173/splash.html"),
            &dev,
            None
        ));
        assert!(!allow_navigation(
            &url("http://localhost:5173/"),
            &dev,
            None
        ));
        assert!(!allow_navigation(
            &url("http://localhost:5173/src/main.tsx"),
            &dev,
            None
        ));
    }

    #[test]
    fn the_tauri_scheme_compares_by_scheme_and_host() {
        let splash = url("tauri://localhost/splash.html");
        assert!(allow_navigation(
            &url("tauri://localhost/splash.html"),
            &splash,
            None
        ));
        assert!(!allow_navigation(&url("tauri://localhost/"), &splash, None));
        assert!(!allow_navigation(&url("tauri://evil/"), &splash, None));
    }

    #[test]
    fn a_remote_script_compares_the_whole_origin_port_included() {
        let remote = url("https://mawl.example.com:8443/");
        let script = launch_token_script("abc_DEF-123", &remote, TokenScope::Origin);
        assert!(script.contains(r#"location.origin !== "https://mawl.example.com:8443""#));
        assert!(!script.contains("location.hostname"));
        // A default port is not written, as `location.origin` does not show it either.
        let plain = launch_token_script("t", &url("https://mawl.example.com/"), TokenScope::Origin);
        assert!(plain.contains(r#"location.origin !== "https://mawl.example.com""#));
    }

    #[test]
    fn a_denied_navigation_to_the_app_origin_is_not_sent_to_the_browser() {
        let app = app_url(47_420);
        assert!(!open_denied_externally(
            &url("http://127.0.0.1:47420/t/sam"),
            &app
        ));
        let remote = url("https://mawl.example.com/");
        assert!(!open_denied_externally(
            &url("https://mawl.example.com/x?y"),
            &remote
        ));
        assert!(open_denied_externally(
            &url("https://example.com/"),
            &remote
        ));
        assert!(open_denied_externally(
            &url("https://mawl.example.com:8443/"),
            &remote
        ));
    }

    #[test]
    fn the_script_guards_on_the_app_scheme_and_host_and_quotes_the_token() {
        let script =
            launch_token_script("abc_DEF-123", &app_url(47_420), TokenScope::LoopbackAnyPort);
        assert!(script.contains(r#"location.protocol !== "http:""#));
        assert!(script.contains(r#"location.hostname !== "127.0.0.1""#));
        assert!(script.contains(r#"value: "abc_DEF-123""#));
        assert!(script.contains("writable: false"));
        assert!(script.contains("window.top !== window"));
        // A hostile value could not break out of the string literal.
        let odd = launch_token_script("a\"b</script>", &app_url(1), TokenScope::LoopbackAnyPort);
        assert!(odd.contains(r#""a\"b</script>""#));
    }
}
