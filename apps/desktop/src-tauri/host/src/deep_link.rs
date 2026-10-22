//! `mawl://` deep links. Pure parsing, no Tauri types, so the allowlist is unit-testable.
//!
//! A link is untrusted input (any web page or app can open one), so only an exact allowlist maps
//! to an in-app path. Everything else is dropped.

/// Maps a `mawl://` URL to an in-app path, or `None` when it is not on the allowlist.
///
/// Allowed:
/// - `mawl://t`, `mawl://t/<slug>` with an optional `?thread=thr_<ULID>` on the slug form
/// - `mawl://activity|approvals|memory|routines|connections|settings`
///
/// One trailing slash is tolerated because browsers add it to host-only URLs.
pub fn parse_deep_link(url: &str) -> Option<String> {
    const SCHEME: &str = "mawl://";
    const SECTIONS: [&str; 6] = [
        "activity",
        "approvals",
        "memory",
        "routines",
        "connections",
        "settings",
    ];

    let head = url.get(..SCHEME.len())?;
    if !head.eq_ignore_ascii_case(SCHEME) {
        return None;
    }
    let rest = &url[SCHEME.len()..];

    // A tiny alphabet rules out percent-encoding, userinfo, ports, fragments, dots, backslashes,
    // whitespace, control characters and non-ASCII in one step.
    if !rest
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'/' | b'?' | b'='))
    {
        return None;
    }

    let (path, query) = match rest.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (rest, None),
    };
    let path = path.strip_suffix('/').unwrap_or(path);

    let segments: Vec<&str> = path.split('/').collect();
    match segments.as_slice() {
        [section] if query.is_none() && SECTIONS.contains(section) => Some(format!("/{section}")),
        ["t"] if query.is_none() => Some("/t".to_owned()),
        ["t", slug] if is_slug(slug) => match query {
            None => Some(format!("/t/{slug}")),
            Some(q) => {
                let id = q.strip_prefix("thread=")?;
                is_thread_id(id).then(|| format!("/t/{slug}?thread={id}"))
            }
        },
        _ => None,
    }
}

/// `[a-z0-9]+(-[a-z0-9]+)*`, at most 64 characters.
fn is_slug(s: &str) -> bool {
    s.len() <= 64
        && s.split('-').all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
        })
}

/// `thr_` plus a 26-character Crockford base32 ULID body, as `@mawl/contracts` ids.
/// The first character is 0-7 because the 48-bit timestamp fills the first 10.
fn is_thread_id(s: &str) -> bool {
    let Some(body) = s.strip_prefix("thr_") else {
        return false;
    };
    let b = body.as_bytes();
    let crockford = |c: u8| {
        c.is_ascii_digit() || (c.is_ascii_uppercase() && !matches!(c, b'I' | b'L' | b'O' | b'U'))
    };
    b.len() == 26 && (b'0'..=b'7').contains(&b[0]) && b[1..].iter().copied().all(crockford)
}

#[cfg(test)]
mod tests {
    use super::*;

    const THREAD: &str = "thr_01HZX3K9Q7M2V8N4P6R0S1T5WY";

    fn ok(url: &str) -> String {
        parse_deep_link(url).unwrap_or_else(|| panic!("expected {url:?} to be allowed"))
    }

    fn rejected(url: &str) {
        assert_eq!(
            parse_deep_link(url),
            None,
            "expected {url:?} to be rejected"
        );
    }

    #[test]
    fn allows_the_plain_sections() {
        for s in [
            "activity",
            "approvals",
            "memory",
            "routines",
            "connections",
            "settings",
        ] {
            assert_eq!(ok(&format!("mawl://{s}")), format!("/{s}"));
        }
    }

    #[test]
    fn allows_the_teammate_list_and_a_teammate() {
        assert_eq!(ok("mawl://t"), "/t");
        assert_eq!(ok("mawl://t/ada"), "/t/ada");
        assert_eq!(ok("mawl://t/research-bot-2"), "/t/research-bot-2");
    }

    #[test]
    fn allows_a_thread_on_a_teammate() {
        assert_eq!(
            ok(&format!("mawl://t/ada?thread={THREAD}")),
            format!("/t/ada?thread={THREAD}")
        );
    }

    #[test]
    fn tolerates_one_trailing_slash_and_a_mixed_case_scheme() {
        assert_eq!(ok("mawl://settings/"), "/settings");
        assert_eq!(ok("mawl://t/ada/"), "/t/ada");
        assert_eq!(ok("MAWL://settings"), "/settings");
    }

    #[test]
    fn rejects_other_schemes_and_missing_scheme() {
        for u in [
            "",
            "mawl:",
            "mawl:/settings",
            "mawl:settings",
            "http://settings",
            "https://t/ada",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "mawl2://settings",
            "xmawl://settings",
            " mawl://settings",
            "settings",
        ] {
            rejected(u);
        }
    }

    #[test]
    fn rejects_unknown_hosts_and_extra_path() {
        for u in [
            "mawl://",
            "mawl://unknown",
            "mawl://Settings",
            "mawl://settings/extra",
            "mawl://settings//",
            "mawl://activity/x",
            "mawl://t/ada/computer",
            "mawl://t//ada",
            "mawl:///settings",
        ] {
            rejected(u);
        }
    }

    #[test]
    fn rejects_traversal_and_encoded_tricks() {
        for u in [
            "mawl://t/..",
            "mawl://t/../settings",
            "mawl://t/a..b",
            "mawl://t/%2e%2e",
            "mawl://t/%2E%2E/settings",
            "mawl://t/ada%2Fx",
            "mawl://t/ada%00",
            "mawl://settings%2F..",
            "mawl://t/ada\\x",
            "mawl://t/ada\\..\\x",
            "mawl://t/ada\n",
            "mawl://t/a\u{0}da",
        ] {
            rejected(u);
        }
    }

    #[test]
    fn rejects_userinfo_ports_and_fragments() {
        for u in [
            "mawl://user@settings",
            "mawl://user:pw@settings",
            "mawl://settings:80",
            "mawl://t:80/ada",
            "mawl://t/ada:80",
            "mawl://settings#frag",
            "mawl://t/ada#frag",
            "mawl://@",
        ] {
            rejected(u);
        }
    }

    #[test]
    fn rejects_bad_slugs() {
        let long = "a".repeat(65);
        for u in [
            "mawl://t/Ada",
            "mawl://t/-ada",
            "mawl://t/ada-",
            "mawl://t/a--b",
            "mawl://t/a_b",
            "mawl://t/a b",
            "mawl://t/ä",
            &format!("mawl://t/{long}"),
        ] {
            rejected(u);
        }
        assert_eq!(
            ok(&format!("mawl://t/{}", "a".repeat(64))),
            format!("/t/{}", "a".repeat(64))
        );
    }

    #[test]
    fn rejects_bad_queries() {
        for u in [
            "mawl://settings?x=1",
            "mawl://t?thread=".to_owned().as_str(),
            &format!("mawl://t?thread={THREAD}"),
            "mawl://t/ada?",
            "mawl://t/ada?thread=",
            "mawl://t/ada?thread=thr_short",
            "mawl://t/ada?thread=thr_01HZX3K9Q7M2V8N4P6R0S1T5WYX",
            "mawl://t/ada?thread=run_01HZX3K9Q7M2V8N4P6R0S1T5WY",
            "mawl://t/ada?thread=thr_01hzx3k9q7m2v8n4p6r0s1t5wy",
            "mawl://t/ada?thread=thr_01HZX3K9Q7M2V8N4P6R0S1T5WI",
            "mawl://t/ada?thread=thr_91HZX3K9Q7M2V8N4P6R0S1T5WY",
            &format!("mawl://t/ada?thread={THREAD}&x=1"),
            &format!("mawl://t/ada?x=1&thread={THREAD}"),
            &format!("mawl://t/ada?thread={THREAD}&thread={THREAD}"),
            &format!("mawl://t/ada?thread={THREAD}&"),
            &format!("mawl://t/ada?thread={THREAD}%00"),
            &format!("mawl://t/ada?thread={THREAD}#x"),
            &format!("mawl://t/ada?Thread={THREAD}"),
            &format!("mawl://t/ada?thread={THREAD}?x=1"),
        ] {
            rejected(u);
        }
    }

    #[test]
    fn never_returns_something_that_is_not_an_absolute_in_app_path() {
        for u in ["mawl://t/ada", "mawl://settings", "mawl://t"] {
            let p = ok(u);
            assert!(p.starts_with('/') && !p.starts_with("//"));
        }
    }
}
