//! Where the server comes from.
//!
//! - **Installed** (D1.7 bundles it): `mawl-server.exe` (Node 24, a Tauri `externalBin`) beside
//!   `Mawl.exe`, and in the resource dir `server\server.mjs` (+ `server\drizzle\`, `server\web\`)
//!   and the Postgres bundle `pg\`.
//! - **Development** (debug builds only, when the installed layout is absent): `node` from `PATH`
//!   on `apps/server/dist/server.mjs` (`pnpm --filter @mawl/server build`). The developer points it
//!   at Postgres with `MAWL_PG_ROOT` or `DATABASE_URL` in their shell; the web app comes from Vite.

use std::fmt;
use std::path::{Path, PathBuf};

pub const SIDECAR_EXE: &str = "mawl-server.exe";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ServerCommand {
    pub program: PathBuf,
    pub script: PathBuf,
    /// The install's Postgres binaries; `None` in development.
    pub pg_root: Option<PathBuf>,
    /// The built web app beside the bundle, when present.
    pub web_dir: Option<PathBuf>,
    pub dev: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LaunchError {
    /// An installed layout is incomplete: reinstalling fixes it.
    Missing(PathBuf),
    /// Development: no `node` on PATH.
    NoNode,
    /// Development: the server bundle has not been built.
    NotBuilt(PathBuf),
}

impl fmt::Display for LaunchError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LaunchError::Missing(path) => write!(f, "missing {}", path.display()),
            LaunchError::NoNode => f.write_str("node was not found on PATH"),
            LaunchError::NotBuilt(path) => write!(
                f,
                "{} is missing: run `pnpm --filter @mawl/server build`",
                path.display()
            ),
        }
    }
}

pub struct Layout<'a> {
    /// The directory of the running `Mawl.exe`.
    pub exe_dir: &'a Path,
    /// Tauri's resource dir.
    pub resource_dir: &'a Path,
    /// The repository root, known in debug builds only.
    pub repo_root: Option<&'a Path>,
    /// The host's `PATH`, for finding `node` in development.
    pub path_env: Option<&'a str>,
}

pub fn resolve(
    layout: &Layout<'_>,
    exists: impl Fn(&Path) -> bool,
) -> Result<ServerCommand, LaunchError> {
    let exe_dir = strip_verbatim(layout.exe_dir);
    let resource_dir = strip_verbatim(layout.resource_dir);
    let sidecar = exe_dir.join(SIDECAR_EXE);
    let server_dir = resource_dir.join("server");
    let script = server_dir.join("server.mjs");
    if exists(&sidecar) || layout.repo_root.is_none() {
        for path in [&sidecar, &script] {
            if !exists(path) {
                return Err(LaunchError::Missing(path.clone()));
            }
        }
        let pg_root = resource_dir.join("pg");
        if !exists(&pg_root) {
            return Err(LaunchError::Missing(pg_root));
        }
        let web_dir = server_dir.join("web");
        return Ok(ServerCommand {
            program: sidecar,
            script,
            pg_root: Some(pg_root),
            web_dir: exists(&web_dir.join("index.html")).then_some(web_dir),
            dev: false,
        });
    }

    // Debug build without an installed layout.
    let repo = layout.repo_root.expect("checked above");
    let script = repo
        .join("apps")
        .join("server")
        .join("dist")
        .join("server.mjs");
    if !exists(&script) {
        return Err(LaunchError::NotBuilt(script));
    }
    let program = find_on_path("node.exe", layout.path_env, &exists).ok_or(LaunchError::NoNode)?;
    Ok(ServerCommand {
        program,
        script,
        pg_root: None,
        web_dir: None,
        dev: true,
    })
}

/// Drops the `\\?\` (or `\\?\UNC\`) prefix Tauri puts on Windows paths. Node's realpath of a main
/// script given as `\\?\C:\...` fails with `EISDIR` on `C:`, so the server never starts.
fn strip_verbatim(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => path.to_path_buf(),
    }
}

fn find_on_path(
    name: &str,
    path_env: Option<&str>,
    exists: &impl Fn(&Path) -> bool,
) -> Option<PathBuf> {
    std::env::split_paths(path_env?)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join(name))
        .find(|candidate| exists(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    fn fs(paths: &[&str]) -> impl Fn(&Path) -> bool {
        let set: HashSet<PathBuf> = paths.iter().map(PathBuf::from).collect();
        move |p: &Path| set.contains(p)
    }

    #[test]
    fn installed_layout() {
        let exists = fs(&[
            r"C:\Mawl\mawl-server.exe",
            r"C:\Mawl\server\server.mjs",
            r"C:\Mawl\pg",
            r"C:\Mawl\server\web\index.html",
        ]);
        let layout = Layout {
            exe_dir: Path::new(r"C:\Mawl"),
            resource_dir: Path::new(r"C:\Mawl"),
            repo_root: None,
            path_env: None,
        };
        let cmd = resolve(&layout, exists).unwrap();
        assert_eq!(cmd.program, PathBuf::from(r"C:\Mawl\mawl-server.exe"));
        assert_eq!(cmd.script, PathBuf::from(r"C:\Mawl\server\server.mjs"));
        assert_eq!(cmd.pg_root, Some(PathBuf::from(r"C:\Mawl\pg")));
        assert_eq!(cmd.web_dir, Some(PathBuf::from(r"C:\Mawl\server\web")));
        assert!(!cmd.dev);
    }

    #[test]
    fn verbatim_prefixes_are_stripped_so_node_can_resolve_the_script() {
        // Tauri hands out `\\?\C:\...` on Windows; node's realpath of such a script path fails
        // with EISDIR on `C:`.
        let exists = fs(&[
            r"C:\Mawl\mawl-server.exe",
            r"C:\Mawl\server\server.mjs",
            r"C:\Mawl\pg",
        ]);
        let layout = Layout {
            exe_dir: Path::new(r"\\?\C:\Mawl"),
            resource_dir: Path::new(r"\\?\C:\Mawl"),
            repo_root: None,
            path_env: None,
        };
        let cmd = resolve(&layout, exists).unwrap();
        assert_eq!(cmd.program, PathBuf::from(r"C:\Mawl\mawl-server.exe"));
        assert_eq!(cmd.script, PathBuf::from(r"C:\Mawl\server\server.mjs"));
        assert_eq!(cmd.pg_root, Some(PathBuf::from(r"C:\Mawl\pg")));
        assert_eq!(
            strip_verbatim(Path::new(r"\\?\UNC\host\share\Mawl")),
            PathBuf::from(r"\\host\share\Mawl")
        );
        assert_eq!(
            strip_verbatim(Path::new(r"C:\plain")),
            PathBuf::from(r"C:\plain")
        );
    }

    #[test]
    fn a_release_build_never_falls_back_to_node() {
        let layout = Layout {
            exe_dir: Path::new(r"C:\Mawl"),
            resource_dir: Path::new(r"C:\Mawl"),
            repo_root: None,
            path_env: Some(r"C:\node"),
        };
        let err = resolve(&layout, fs(&[r"C:\node\node.exe"])).unwrap_err();
        assert_eq!(
            err,
            LaunchError::Missing(PathBuf::from(r"C:\Mawl\mawl-server.exe"))
        );
        let err = resolve(&layout, fs(&[r"C:\Mawl\mawl-server.exe"])).unwrap_err();
        assert_eq!(
            err,
            LaunchError::Missing(PathBuf::from(r"C:\Mawl\server\server.mjs"))
        );
    }

    #[test]
    fn dev_uses_node_from_path_on_the_built_bundle() {
        let layout = Layout {
            exe_dir: Path::new(r"D:\repo\target\debug"),
            resource_dir: Path::new(r"D:\repo\target\debug"),
            repo_root: Some(Path::new(r"D:\repo")),
            path_env: Some(r"relative;C:\Windows;C:\node"),
        };
        let cmd = resolve(
            &layout,
            fs(&[
                r"D:\repo\apps\server\dist\server.mjs",
                r"C:\node\node.exe",
                r"relative\node.exe",
            ]),
        )
        .unwrap();
        assert_eq!(cmd.program, PathBuf::from(r"C:\node\node.exe"));
        assert_eq!(
            cmd.script,
            PathBuf::from(r"D:\repo\apps\server\dist\server.mjs")
        );
        assert_eq!(cmd.pg_root, None);
        assert!(cmd.dev);

        let err = resolve(&layout, fs(&[r"C:\node\node.exe"])).unwrap_err();
        assert!(matches!(err, LaunchError::NotBuilt(_)));
        assert!(err.to_string().contains("pnpm --filter @mawl/server build"));
        let err = resolve(&layout, fs(&[r"D:\repo\apps\server\dist\server.mjs"])).unwrap_err();
        assert_eq!(err, LaunchError::NoNode);
    }
}
