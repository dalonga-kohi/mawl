# Handoff: after D1.5a (2026-10-22)

## State
- Branch `slice/D1.5-tauri-host`, based on `main` at 50f5f88 (D1.4 merged). D1.5a is finished and listed as done in PLAN; the PR for it is open.
- D1.5 was split. D1.5a (supervisor, launch token injection, CSP, splash, clean quit) is done. **D1.5b is next.**

## Next: D1.5b Shell polish (head-coder, UI)
Scope as in PLAN D1.5: tray with the mascot state, close-to-tray polish, autostart at login (on by default, with a toggle), notifications, power events forwarded to the server, deep-link navigation wiring (the web page has no IPC today, so this needs a design), the `onSpawn`/abort hook for `startEmbeddedPostgres`, and "connect to a remote Mawl". External links are denied until this slice (`on_new_window` returns `Deny`).

Open product questions from D1.5a, to settle in the D1.5b brief:
- The splash cannot see the owner's accent or theme (it is a separate page). Options: store the choice in the host data dir, or read it from the web app's storage.
- A server restart sends the owner back to the splash and reloads the app. Decide whether to keep the page and show a reconnecting banner instead.
- Deep links: the app page runs on a remote origin and has no Tauri IPC by design (ACL, no `remote` capability). Pick an event channel that does not weaken that.

## Things to know
- Host logic lives in the Tauri-free crate `apps/desktop/src-tauri/host` (`mawl-host`), because any test binary that links Tauri dies on Windows with `STATUS_ENTRYPOINT_NOT_FOUND`. `src/shell.rs` is the glue. Test with `cargo test -p mawl-host`.
- The remote-origin ACL is proven from config (`apps/desktop/src/acl.test.ts`) and Tauri's own rule, not at runtime. A runtime check belongs on the D1.7 Windows CI.
- In dev the app runs on Vite's origin, which Tauri treats as local, so the app page can call the host commands there. Release builds are unaffected.
- `externalBin` (the bundled node sidecar) is deferred to D1.7.
- Never run the full gate, Docker suites or e2e unasked (they lag the PC). See CLAUDE.md Platform.
- Not yet done and not verified: `tauri build`, a real boot with embedded Postgres through the host, e2e.
- Head-review of D1.5a was not run (it touches the token flow and CSP). Propose it before D1.5b builds on it, or at the D1 phase close.

## Pending in PLAN after D1.5b
D1.6 master key in Credential Manager, D1.7 installer/updater/Windows CI (where the runtime ACL test and `externalBin` land), D1.8 onboarding (needs the Claude pre-download step with progress, see D1.3b follow-ups). Still waiting on the user for image assets: Pip/Mawl mascot sheet, app icon, onboarding illustration (see DESIGN.md §8).

## Loop reminders
Sync first (`git fetch --all --prune`, switch to `main`, `git pull --ff-only`), then branch `slice/<id>-<name>`. UI work goes to `head-coder`; the voice is caveman default; commits carry the model trailer.
