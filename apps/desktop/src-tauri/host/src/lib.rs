//! The Mawl desktop host's logic, kept apart from Tauri so all of it runs under `cargo test`.
//!
//! - `machine`: the supervisor's decisions (pure)
//! - `deep_link`: the `mawl://` allowlist (pure)

pub mod deep_link;
pub mod machine;
