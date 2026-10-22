//! Navigation rules and the server environment, against hostile and odd inputs.

use std::path::Path;

use mawl_host::env::{server_env, ServerEnv};
use mawl_host::webview::{allow_navigation, app_url, launch_token_script};
use url::Url;

fn url(s: &str) -> Url {
    Url::parse(s).unwrap()
}

#[test]
fn lookalike_hosts_userinfo_and_ports_are_refused() {
    let splash = url("http://tauri.localhost/splash.html");
    let app = app_url(47_420);
    let denied = [
        "http://127.0.0.1.evil.com:47420/",
        "http://evil.com/127.0.0.1:47420/",
        "http://127.0.0.1:47420@evil.com/",
        "http://127.0.0.1:47420:80@evil.com/",
        "http://127.0.0.2:47420/",
        "http://[::ffff:127.0.0.1]:47420/",
        "http://[::1]:47420/",
        "http://127.0.0.1:80/",
        "http://127.0.0.1/",
        "http://127.0.0.1:47420.evil.com/",
        "http://tauri.localhost.evil.com/",
        "http://evil.tauri.localhost/",
        "http://tauri.localhost:8080/",
        "https://tauri.localhost/",
        "ws://127.0.0.1:47420/",
        "ftp://127.0.0.1:47420/",
        "blob:http://127.0.0.1:47420/abc",
        "javascript:alert(1)",
        "about:blank#x",
        "about:srcdoc",
        "view-source:http://127.0.0.1:47420/",
        "tauri://localhost/",
    ];
    for target in denied {
        // A target the URL parser itself rejects can never be navigated to.
        let Ok(target_url) = Url::parse(target) else {
            continue;
        };
        assert!(
            !allow_navigation(&target_url, &splash, Some(&app)),
            "{target} must be refused"
        );
    }
}

#[test]
fn the_same_origin_spelled_differently_is_allowed() {
    let splash = url("http://tauri.localhost/splash.html");
    let app = app_url(47_420);
    for target in [
        "HTTP://127.0.0.1:47420/",
        "http://127.0.0.1:47420",
        "http://127.0.0.1:047420/x?y=1#z",
        "http://TAURI.localhost/other.html",
        "http://tauri.localhost:80/",
    ] {
        assert!(
            allow_navigation(&url(target), &splash, Some(&app)),
            "{target}"
        );
    }
}

#[test]
fn after_a_port_move_only_the_new_port_is_allowed() {
    let splash = url("http://tauri.localhost/splash.html");
    let old = app_url(47_420);
    let new = app_url(47_421);
    assert!(allow_navigation(
        &url("http://127.0.0.1:47421/"),
        &splash,
        Some(&new)
    ));
    assert!(!allow_navigation(
        &url("http://127.0.0.1:47420/"),
        &splash,
        Some(&new)
    ));
    assert!(!allow_navigation(
        &url("http://127.0.0.1:47421/"),
        &splash,
        Some(&old)
    ));
}

#[test]
fn the_token_script_cannot_be_broken_out_of() {
    for token in [
        "\"; alert(1); \"",
        "\\",
        "</script><script>alert(1)</script>",
        "line\nbreak\u{2028}\u{2029}",
        "日本語🙂",
        "",
    ] {
        let script = launch_token_script(token, &app_url(1));
        let quoted = serde_json::to_string(token).unwrap();
        assert!(script.contains(&format!("value: {quoted},")), "{token:?}");
        assert!(!script.contains("alert(1); \"\n"), "{token:?}");
    }
}

#[test]
fn the_token_script_is_main_frame_only_and_locked() {
    let script = launch_token_script("t", &app_url(47_420));
    assert!(script.contains("window.top !== window"));
    assert!(script.contains("configurable: false"));
    assert!(script.contains("enumerable: false"));
    // The guard returns before it defines anything.
    assert!(script.find("return;").unwrap() < script.find("defineProperty").unwrap());
}

fn pairs(list: &[(&str, &str)]) -> Vec<(String, String)> {
    list.iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
}

fn names(env: &[(String, String)]) -> Vec<String> {
    let mut n: Vec<String> = env.iter().map(|(k, _)| k.clone()).collect();
    n.sort();
    n
}

#[test]
fn near_miss_names_and_secrets_are_not_inherited() {
    let host = pairs(&[
        ("PATH", "p"),
        ("PATH_EXTRA", "x"),
        ("NODE_PATH", "x"),
        ("NODE_OPTIONS", "--inspect"),
        ("NODE_EXTRA_CA_CERTS", "x"),
        ("npm_config_registry", "x"),
        ("ANTHROPIC_API_KEY", "k"),
        ("OPENAI_API_KEY", "k"),
        ("AWS_SECRET_ACCESS_KEY", "k"),
        ("HTTP_PROXY", "x"),
        ("TEMPLATE", "x"),
        ("MAWL_LAUNCH_TOKEN", "x"),
        ("MAWL_DATABASE_URL", "x"),
        ("PGPASSWORD", "x"),
        ("PGHOST", "x"),
        ("HOME", "x"),
        ("LD_PRELOAD", "x"),
    ]);
    let data = Path::new(r"C:\d");
    for dev in [false, true] {
        let env = server_env(
            host.clone(),
            &ServerEnv {
                data_dir: data,
                pg_root: None,
                web_dir: None,
                port: 1,
                dev,
            },
        );
        for n in names(&env) {
            assert!(
                n == "PATH" || n.starts_with("MAWL_") || n == "NODE_ENV" || n == "LOG_LEVEL",
                "dev={dev}: {n} leaked"
            );
        }
        assert!(!env.iter().any(|(_, v)| v == "k" || v == "--inspect"));
    }
}

#[test]
fn the_host_cannot_override_what_the_launch_decides() {
    let host = pairs(&[
        ("mawl_mode", "headless"),
        ("MAWL_HOST", "0.0.0.0"),
        ("MAWL_DATA_DIR", r"C:\elsewhere"),
        ("NODE_ENV", "development"),
        ("path", "lower"),
        ("PATH", "upper"),
    ]);
    let data = Path::new(r"C:\mine");
    let env = server_env(
        host,
        &ServerEnv {
            data_dir: data,
            pg_root: None,
            web_dir: None,
            port: 9,
            dev: true,
        },
    );
    let get = |n: &str| {
        env.iter()
            .filter(|(k, _)| k.eq_ignore_ascii_case(n))
            .map(|(_, v)| v.as_str())
            .collect::<Vec<_>>()
    };
    assert_eq!(get("MAWL_MODE"), ["desktop"]);
    assert_eq!(get("MAWL_HOST"), ["127.0.0.1"]);
    assert_eq!(get("MAWL_DATA_DIR"), [r"C:\mine"]);
    assert_eq!(get("NODE_ENV"), ["production"]);
    assert_eq!(get("PATH").len(), 1, "one PATH, whatever the host's casing");
}

#[test]
fn empty_and_unicode_values_and_a_missing_host_env_are_fine() {
    let data = Path::new("C:\\données\\日本");
    let env = server_env(
        pairs(&[("USERNAME", ""), ("TEMP", "C:\\tmp\\é")]),
        &ServerEnv {
            data_dir: data,
            pg_root: None,
            web_dir: None,
            port: 65_535,
            dev: false,
        },
    );
    assert!(env.contains(&("USERNAME".into(), String::new())));
    assert!(env.contains(&("TEMP".into(), "C:\\tmp\\é".into())));
    assert!(env.contains(&("MAWL_PORT".into(), "65535".into())));
    assert!(env.contains(&("MAWL_DATA_DIR".into(), "C:\\données\\日本".into())));
    let none = server_env(
        Vec::new(),
        &ServerEnv {
            data_dir: data,
            pg_root: None,
            web_dir: None,
            port: 1,
            dev: false,
        },
    );
    assert!(none
        .iter()
        .all(|(k, _)| k.starts_with("MAWL_") || k == "NODE_ENV" || k == "LOG_LEVEL"));
}
