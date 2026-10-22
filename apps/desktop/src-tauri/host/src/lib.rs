//! The Mawl desktop host's logic, kept apart from Tauri so all of it runs under `cargo test`.
//!
//! - `machine`: the supervisor's decisions (pure)
//! - `token`, `env`, `logs`, `port`, `webview`: launch token, server environment, diagnostics,
//!   port choice, token injection and navigation rules
//! - `health`: the `/healthz` probe
//! - `deep_link`: the `mawl://` allowlist (pure)

pub mod autostart;
pub mod deep_link;
pub mod driver;
pub mod env;
pub mod external_link;
pub mod health;
pub mod launch;
pub mod logs;
pub mod machine;
pub mod markers;
pub mod notice;
pub mod port;
pub mod presence;
pub mod process;
pub mod token;
pub mod tray;
pub mod webview;
