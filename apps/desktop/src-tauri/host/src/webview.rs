//! How the main window treats the launch token and navigation.
//!
//! The window starts on the bundled splash (Tauri's own origin) and moves to the web app the
//! server serves at `http://127.0.0.1:<port>/` once `/healthz` answers with the proof that it is
//! our server (`health::identity_proof`). The token reaches that page through an initialization
//! script, which the webview runs in the main frame only, before any page script. The script only
//! defines the token on the app's scheme and host, and the navigation handler keeps the main
//! frame on the splash or the app's exact origin. What it does not cover: frames inside the app
//! page get no initialization script (and the server's CSP forbids frames), and pop-ups are
//! refused by the window's `on_new_window` handler, so they never load at all. The port is not
//! compared in the script because the server may move to a new port during a restart;
//! navigation compares it.

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
pub fn allow_navigation(target: &Url, splash: &Url, app: Option<&Url>) -> bool {
    if target.as_str() == "about:blank" {
        return true;
    }
    same_origin(target, splash) || app.is_some_and(|app| same_origin(target, app))
}

/// The script that defines `window.__MAWL_LAUNCH_TOKEN__` on the app's pages only. Read-only and
/// not enumerable, so a careless `JSON.stringify(window)`-style dump does not carry it.
pub fn launch_token_script(token: &str, app: &Url) -> String {
    let quote = |s: &str| serde_json::to_string(s).expect("a string always serializes");
    format!(
        r#"(function () {{
  if (window.top !== window) return;
  if (location.protocol !== {protocol} || location.hostname !== {host}) return;
  Object.defineProperty(window, "__MAWL_LAUNCH_TOKEN__", {{
    value: {token},
    writable: false,
    enumerable: false,
    configurable: false
  }});
}})();
"#,
        protocol = quote(&format!("{}:", app.scheme())),
        host = quote(app.host_str().unwrap_or("")),
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
    fn the_tauri_scheme_compares_by_scheme_and_host() {
        let splash = url("tauri://localhost/splash.html");
        assert!(allow_navigation(&url("tauri://localhost/"), &splash, None));
        assert!(!allow_navigation(&url("tauri://evil/"), &splash, None));
    }

    #[test]
    fn the_script_guards_on_the_app_scheme_and_host_and_quotes_the_token() {
        let script = launch_token_script("abc_DEF-123", &app_url(47_420));
        assert!(script.contains(r#"location.protocol !== "http:""#));
        assert!(script.contains(r#"location.hostname !== "127.0.0.1""#));
        assert!(script.contains(r#"value: "abc_DEF-123""#));
        assert!(script.contains("writable: false"));
        assert!(script.contains("window.top !== window"));
        // A hostile value could not break out of the string literal.
        let odd = launch_token_script("a\"b</script>", &app_url(1));
        assert!(odd.contains(r#""a\"b</script>""#));
    }
}
