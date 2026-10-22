//! The server's environment: cleared, then an allowlist of the user's variables plus Mawl's own.
//!
//! Left out on purpose: `NODE_OPTIONS` and other `NODE_*` (code injection into the sidecar),
//! provider keys such as `OPENAI_API_KEY` (the AI SDK reads them as silent defaults; Mawl's keys
//! live in its own store), and anything else the user's shell happens to carry.

use std::path::Path;

/// Copied from the host's environment when present. Windows names are case-insensitive.
pub const INHERITED: &[&str] = &[
    "SystemRoot",
    "SystemDrive",
    "windir",
    "ComSpec",
    "PATH",
    "PATHEXT",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "USERNAME",
    "HOMEDRIVE",
    "HOMEPATH",
    "APPDATA",
    "LOCALAPPDATA",
    "ProgramData",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "ProgramW6432",
    "CommonProgramFiles",
    "NUMBER_OF_PROCESSORS",
    "PROCESSOR_ARCHITECTURE",
    "OS",
];

/// Also copied in development builds, so a developer can point the server at their own database
/// or Postgres binaries and turn up the log level.
pub const DEV_INHERITED: &[&str] = &["DATABASE_URL", "MAWL_PG_ROOT", "LOG_LEVEL"];

/// What the host decides for this launch.
#[derive(Debug, Clone)]
pub struct ServerEnv<'a> {
    pub data_dir: &'a Path,
    /// The install's `pg\`. `None` in a dev build that relies on `MAWL_PG_ROOT`/`DATABASE_URL`.
    pub pg_root: Option<&'a Path>,
    /// The built web app to serve, when there is one.
    pub web_dir: Option<&'a Path>,
    pub port: u16,
    pub dev: bool,
}

/// The complete environment for the server process, in a stable order.
pub fn server_env<I>(host: I, launch: &ServerEnv<'_>) -> Vec<(String, String)>
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut out: Vec<(String, String)> = Vec::new();
    let host: Vec<(String, String)> = host.into_iter().collect();
    let pick = |names: &[&str], out: &mut Vec<(String, String)>| {
        for name in names {
            if let Some((_, value)) = host.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)) {
                out.push(((*name).to_string(), value.clone()));
            }
        }
    };
    pick(INHERITED, &mut out);
    if launch.dev {
        pick(DEV_INHERITED, &mut out);
    }

    let mut set = |name: &str, value: String| {
        out.retain(|(k, _)| !k.eq_ignore_ascii_case(name));
        out.push((name.to_string(), value));
    };
    set("MAWL_MODE", "desktop".into());
    set("MAWL_HOST", "127.0.0.1".into());
    set("MAWL_PORT", launch.port.to_string());
    set("MAWL_DATA_DIR", path_string(launch.data_dir));
    if let Some(pg_root) = launch.pg_root {
        set("MAWL_PG_ROOT", path_string(pg_root));
    }
    if let Some(web_dir) = launch.web_dir {
        set("MAWL_WEB_DIR", path_string(web_dir));
    }
    set("NODE_ENV", "production".into());
    if !launch.dev {
        set("LOG_LEVEL", "info".into());
    }
    out
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn host() -> Vec<(String, String)> {
        [
            ("Path", r"C:\Windows;C:\node"),
            ("SYSTEMROOT", r"C:\Windows"),
            ("TEMP", r"C:\Users\me\AppData\Local\Temp"),
            ("NODE_OPTIONS", "--require evil.js"),
            ("OPENAI_API_KEY", "sk-live"),
            ("DATABASE_URL", "postgres://dev"),
            ("MAWL_PG_ROOT", r"D:\pg"),
            ("MAWL_PORT", "1"),
            ("MAWL_OWNER_TOKEN", "x"),
            ("LOG_LEVEL", "debug"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect()
    }

    fn get<'a>(env: &'a [(String, String)], name: &str) -> Option<&'a str> {
        env.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    #[test]
    fn release_keeps_only_the_allowlist_and_sets_desktop_mode() {
        let data = PathBuf::from(r"C:\Users\me\AppData\Local\app.mawl.desktop");
        let pg = PathBuf::from(r"C:\Program Files\Mawl\pg");
        let env = server_env(
            host(),
            &ServerEnv {
                data_dir: &data,
                pg_root: Some(&pg),
                web_dir: None,
                port: 47420,
                dev: false,
            },
        );
        assert_eq!(get(&env, "PATH"), Some(r"C:\Windows;C:\node"));
        assert_eq!(get(&env, "SystemRoot"), Some(r"C:\Windows"));
        assert_eq!(get(&env, "MAWL_MODE"), Some("desktop"));
        assert_eq!(get(&env, "MAWL_HOST"), Some("127.0.0.1"));
        assert_eq!(get(&env, "MAWL_PORT"), Some("47420"));
        assert_eq!(get(&env, "MAWL_PG_ROOT"), Some(r"C:\Program Files\Mawl\pg"));
        assert_eq!(get(&env, "LOG_LEVEL"), Some("info"));
        for gone in [
            "NODE_OPTIONS",
            "OPENAI_API_KEY",
            "DATABASE_URL",
            "MAWL_OWNER_TOKEN",
        ] {
            assert_eq!(get(&env, gone), None, "{gone}");
        }
        assert_eq!(get(&env, "MAWL_WEB_DIR"), None);
        // Every name appears once.
        for (name, _) in &env {
            let n = env
                .iter()
                .filter(|(k, _)| k.eq_ignore_ascii_case(name))
                .count();
            assert_eq!(n, 1, "{name}");
        }
    }

    #[test]
    fn dev_passes_the_developer_database_through_but_never_a_token() {
        let data = PathBuf::from(r"C:\data");
        let web = PathBuf::from(r"C:\web");
        let env = server_env(
            host(),
            &ServerEnv {
                data_dir: &data,
                pg_root: None,
                web_dir: Some(&web),
                port: 7420,
                dev: true,
            },
        );
        assert_eq!(get(&env, "DATABASE_URL"), Some("postgres://dev"));
        assert_eq!(get(&env, "MAWL_PG_ROOT"), Some(r"D:\pg"));
        assert_eq!(get(&env, "LOG_LEVEL"), Some("debug"));
        assert_eq!(get(&env, "MAWL_WEB_DIR"), Some(r"C:\web"));
        assert_eq!(get(&env, "MAWL_PORT"), Some("7420"));
        assert_eq!(get(&env, "MAWL_OWNER_TOKEN"), None);
        assert_eq!(get(&env, "NODE_OPTIONS"), None);
    }
}
