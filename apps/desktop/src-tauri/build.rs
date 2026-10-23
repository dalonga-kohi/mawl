/// The app's own commands. Declaring them puts every app command under the ACL: a command runs
/// only when a capability allows it, and `capabilities/host.json` allows them for local pages
/// (the splash) only. Keep in step with `generate_handler!` in src/lib.rs (a test checks it).
const COMMANDS: &[&str] = &[
    "supervisor_status",
    "copy_diagnostics",
    "retry_server",
    "quit_app",
    "enter_app",
    "splash_shown",
    "host_target",
    "splash_appearance",
    "check_remote",
    "connect_remote",
    "use_local_mawl",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("tauri-build failed");
}
