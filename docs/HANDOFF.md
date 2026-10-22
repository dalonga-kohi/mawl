# Handoff: after D1.5b1 (2026-10-22)

## State
- Branch `slice/D1.5b1-shell-tray`, 12 commits on top of `main` ff9e684 (D1.5a merged). Not pushed, no PR yet. It carries the D1.5a head-review fixes, the tray/login/notification half of D1.5b, and the app icon (black, tilted Mawl; `design/assets/app-icon.svg`).
- Head-review of D1.5a ran (3 fixes done: enter/leave race, app origin only while Ready, splash-only path). Reviewer approved D1.5b1 with minors, now listed in PLAN under D1.5b2.

## Next: D1.5b2 (head-coder, hard: token flow, new server endpoint)
Scope in PLAN. Decided channel: host -> server over loopback with the launch token, then server -> app over `/ws`. The app page gets no IPC and no `remote` capability (a test enforces it). Also needs the Windows logoff handling (`WM_QUERYENDSESSION`) and a start-hidden-aware flow already in place (`--autostart`).

## Things to know
- Host logic in the Tauri-free crate `mawl-host`; glue in `src/shell.rs`, `src/tray.rs`, `src/lib.rs`. Test with `cargo test -p mawl-host`; never `cargo test` on `mawl-desktop`.
- New: `presence.rs` (ready + in-app under one lock), `notice.rs`, `markers.rs`, `tauri-plugin-autostart` 2.7.0, rust-version 1.90.
- Not verified: `tauri build`, real tray/login item/notifications on Windows, a real boot with embedded Postgres, e2e. Never run the full gate or Docker suites unasked.
- Pending images: onboarding illustration, tray art per status (placeholder dots).
