# Mawl — Implementation Plan

This is the working roadmap the orchestrator follows. Each **slice** is a vertical, testable unit, sized for one round of the orchestration loop (see CLAUDE.md). Mark a slice `[x]` only after the runner, test-author and reviewer all pass (and the head-reviewer, when the user approved one). Add the short commit range next to it.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (write why)

## L1 — Public landing page

- **Responsive follow-up (2026-10-23):** removed the hero mascot scene and its caption/controls at 1100 px and below, with a compact text-led hero instead. Desktop artwork now fits its grid column without negative offsets or clipping the glow. Browser checks at 320/390/620/760/900/1100/1101/1280/1440 px show no horizontal overflow; inspected mobile, tablet and desktop compositions. Scoped CSS Biome and diff checks pass. The owner approved pushing the branch and opening a PR after reviewing these refinements. Merge and publication require separate approval.

- [x] **L1.1 Cinematic product showcase.** (1c18ea7..90db828) User-selected dark direction: Ink neutrals, pistachio Mawl, locally hosted Bricolage Grotesque and Figtree fonts. A spacious hero leads into an illustrative, interactive preview of the current chat app, provider choice, local hosting, development status, and the GitHub repository. The faithful mascot breathes, blinks, wags its tail and greets a click or keyboard activation; a pause control, reduced-motion styles and offscreen/tab suspension keep motion optional. The Chat/Connections and Light/Dark controls work without connecting real accounts. Keep `site/` buildless for Cloudflare Pages. Promote only implemented capabilities; memory, computers, schedules and remote channels remain roadmap work. No app runtime, sign-up, invented metrics or download promise. Other agent's desktop work is outside this slice.
  - **Deployment repair:** the previous landing workflow failed with `ERR_PNPM_ADDING_TO_ROOT` while installing Wrangler. The action now uses npm in a separate temporary project, pins Wrangler 4.152.0, and uploads the absolute `site/` path without installing the monorepo.
  - **Verified:** six static asset/navigation and workflow regression tests, scoped Biome, root TypeScript, JS syntax and diff checks; rendered at 320/390/760/1100/1440 px without horizontal overflow; preview switches, keyboard greeting, pause/resume, offscreen suspension and native FAQ keyboard behavior. No browser errors. Astra approved the final code and screenshots. Reduced motion and no-JS fallback were inspected in source; OS reduced-motion emulation was unavailable. No full gate, Docker suites or app e2e: the app runtime was not changed. Push and PR approved by the owner; merge and publication await approval.

> **Redesign 2026-10 ([REDESIGN.md](REDESIGN.md)).** Mawl becomes desktop-first: the Tauri app hosts the server and an embedded Postgres, and Docker is only needed for computers. P0 and P1 stay as the record of what was built. The old phases P2 to P8 are replaced by D1 to D9 below (re-sliced 2026-10-21; every open review note was carried into its new slice). P1.8 is re-scoped into D1.4.

## D0 — Spikes (de-risk the redesign)

- [x] **D0.1 Embedded Postgres + pgvector on Windows.** (spike; works, results and decisions in REDESIGN §10.1; recipe `infra/desktop/pgvector/build-vector-mingw.ps1`) Prove that the server can start a bundled Postgres 17 on Windows as a child process (random loopback port, `initdb` on first run, clean stop) and load a `vector` extension built for those exact binaries. Run the existing `@mawl/db` migrations and one HNSW vector query against it. Write the result, versions and the build recipe into REDESIGN §10. If it fails, record why and the fallback (PGlite + own queue).
- [x] **D0.2 Sidecar packaging.** (spike; `node.exe` sidecar, the SDK JS bundled, the Claude binary downloaded on first use, a 46 MiB installer; results in REDESIGN §10.2) Node SEA vs a shipped `node.exe` as a Tauri `externalBin`; check that `@anthropic-ai/claude-agent-sdk`'s native package resolves from an install dir; measure the installer size.

---

## P0 — Foundation
Goal: an empty but real monorepo with CI, tokens and test infrastructure. Nothing user-facing yet.

- [x] **P0.1 Scaffold monorepo.** (7432cc0..dd50c20) Set up the workspace and tooling.
  - pnpm workspace (pnpm 10.18.0 via corepack), Turborepo, TS strict base config, Biome, Vitest `test.projects`, `.editorconfig`, `.nvmrc` (Node 24 LTS).
  - Empty packages per ARCHITECTURE §2, each with a passing smoke test.
  - *Accept:* `pnpm i && pnpm turbo lint typecheck test` is green.
- [x] **P0.2 CI.** (1de9ff0..044fca8) GitHub Actions running lint, typecheck, test, and build with the Turbo cache. A Postgres service is used for integration tests.
- [x] **P0.3 Design tokens.** (a8e94f4..a990ad4) In `packages/ui`, turn the DESIGN.md tokens into CSS variables plus a TS export.
  - Includes the accent engine: input hex → OKLCH scale → `--accent-*`.
  - *Tests:* contrast ratios ≥ 4.5 for text-on-accent across all presets in light and dark.
- [x] **P0.4 testkit.** (abc0d7f..860fc19; Postgres smoke test unverified locally, needs Docker) A scripted fake `LanguageModelV2` (deterministic text, tool calls, streaming), fixture builders, and a Testcontainers Postgres helper.
- [x] **P0.5 Contracts.** (3ed19c5..e43365d) zod schemas for the core entities and the event union, plus an oRPC router skeleton.

## P1 — Talk to a teammate (web + desktop)
Goal: chat in a real UI with one profile, streaming from a real or fake model.

- [x] **P1.1 DB schema v1.** (b19c779..b1b36eb; the Testcontainers half was verified later against real Postgres with Docker Desktop) Drizzle migrations for `profiles`, `provider_credentials`, `threads`, `messages`, `runs`, `run_steps`, `artifacts`, `events`. Add pgvector/FTS extensions.
  - Drizzle 0.45.4, drizzle-kit 0.31.11, PGlite 0.5.10 (+ `@electric-sql/pglite-pgvector`) runs the same suite locally without Docker.
- [x] **P1.2 Server skeleton.** (bad1d4b..5aec5bb; all suites green with `MAWL_REQUIRE_DOCKER=1`)
  - Decided: keep the base `bundler` tsconfig. Dev runs `tsx watch`, and prod is an esbuild bundle (`dist/server.mjs` + `dist/drizzle`). Native Node type stripping is out because workspace packages use extensionless relative imports.
  - Hono + oRPC + health endpoint + pino.
  - Secret key bootstrapped on first boot, with libsodium encrypt/decrypt.
- [x] **P1.3 Provider registry.** (8da5da9..2db16a4; all suites green with `MAWL_REQUIRE_DOCKER=1`) Add the contract procedures `providers.list/create/delete/test`, with the secret only in a strictObject input (review note from P0.5).
  - Anthropic, OpenAI, OpenRouter, Ollama, and OpenAI-compatible providers, with capability flags.
  - `providers.test()` validates a key.
- [x] **P1.3b Sign in with ChatGPT (the preferred way to use Mawl).** (ef3c6c4..535f1a9; all suites green with `MAWL_REQUIRE_DOCKER=1`; security properties mutation-checked) The owner signs in with a ChatGPT Plus/Pro account, and runs use that plan's limits instead of an API key. API keys stay as the alternative.
  - Uses OpenAI's "Sign in with ChatGPT" plan-usage flow for open-source and locally run apps (developers.openai.com/siwc/token-sharing-open-source): OIDC + PKCE, `client_id=dynamic_agent_client` (OpenAI issues the client id during the first sign-in; persist it before the code exchange), a loopback callback on `127.0.0.1`, and Responses API scopes.
  - New `ProviderKind` `openai_chatgpt`. Its credential row stores the issued client id, OAuth tokens and account info, encrypted like API keys. A persisted opaque host id (`urn:uuid:`, never user-identifying) is shared by every credential on this server.
  - Inference goes to `https://api.openai.com/v1` Responses with the OAuth access token, `store: false`, `stream: true`. Refresh tokens before expiry, handle revocation and logout, and map plan-limit errors to a clear "plan limit reached" run failure.
  - Where the browser runs: v1 handles the callback on the server host (the browser is on the same machine). The desktop app (P1.8) runs the loopback flow itself and transfers the credentials to the server over an authenticated call, as the SIWC self-hosted guidance describes.
  - Follow OpenAI's SIWC UI/UX guidelines for the sign-in button, plan usage and plan selection. Onboarding (P8.1) offers "Sign in with ChatGPT" first.
  - Eligibility: OpenAI allows plan usage for open-source projects and personal projects that run locally. A paid or remotely hosted distribution of Mawl needs OpenAI's interest form first; check before P8.5.
  - Verify every endpoint, scope and error code from OpenAI's current docs at slice start. This bullet list is a research summary, not a verified API.
  - Verified 2026-10-18 (developers.openai.com/siwc/token-sharing-open-source): authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`, discovery `https://auth.openai.com/.well-known/openid-configuration` (revocation endpoint). Scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`, PKCE S256, redirect `http://127.0.0.1:<port>/auth/callback` (never `localhost`). `ext_agent_host_id` as `urn:uuid:` v4. Access tokens live 3600 s; refresh tokens rotate and live 30 days. Errors `subscription_sharing_*` (`usage_limit_exceeded` 429 → plan limit reached). Unsupported Responses fields (`temperature`, `max_output_tokens`, `top_p`, ...) are stripped. No official SDK; the `@ai-sdk/openai` Responses model is used with a token-injecting fetch.
  - **Claude account (owner decision 2026-10-18: Mawl is a personal, self-hosted project, not distributed).** New `ProviderKind` `anthropic_claude_code`: runs the unmodified Claude Code binary through `@anthropic-ai/claude-agent-sdk`, and the owner signs in with Claude Code's own flow (`claude auth login` on the server host or container). Mawl never collects, stores or reads Claude.ai credentials, which is the only subscription path Anthropic's terms allow (code.claude.com/docs/en/legal-and-compliance: "sign-in to a Claude account must complete through Anthropic's own flow"). Built-in tools disabled, no setting sources, clean env (no `ANTHROPIC_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*`). If Mawl is ever distributed or multi-user, this provider must go (check before P8.5).
- [x] **P1.4 Run engine v1.** (1abc23c..e9bc662; gate green with `MAWL_REQUIRE_DOCKER=1`; CAS, atomic steps, crash resume and budgets mutation-checked)
  - Decided: `profiles.model_main` is `<credentialId>:<modelId>` (split at the first `:`); `runs.error` holds a closed `RunErrorCode`; the wall-clock budget counts active time (`runs.active_ms`, migration 0005); Graphile Worker 0.18.0 runs task `run.execute` with boot recovery. Cost cap and `contextWindow` are not built yet (S7, P3.5).
  - AI SDK v7 loop with durable steps, the run state machine (queued → running → succeeded/failed/cancelled), and budget caps.
  - Graphile Worker job.
  - *Tests:* fake model; crash/resume from the persisted step.
  - Review note from P1.1: drizzle writes JS `null` as SQL NULL, so NOT NULL jsonb columns (`run_steps.input_json`, `events.payload_json`) need `jsonValue()` from `@mawl/db`. Put `run_steps`/`events` inserts and updates behind one repository helper that always applies it, and test that a raw `null` is stored as JSON null.
  - Thread deletion is blocked while runs reference the thread (FK, no action). Decide archive vs delete when a thread-delete path appears.
  - Review notes from P1.3b:
    - The `openai_chatgpt` model refuses non-stream calls, so the loop uses `streamText`, never `generateText`.
    - `anthropic_claude_code` is text-only. Bridge Mawl tools to it through an in-process MCP server (the SDK's `createSdkMcpServer`), still through the policy engine.
    - A Claude `rate_limit_event` with status `rejected` is a hard failure today, even when overage may be allowed. Revisit when overage info is reliable.
    - `ProviderFailureReason` (contracts) from `ProviderFailureError` (core) feeds the run failure reason and the app's explanation.
    - `@mawl/server#test` failed once under the full parallel gate even after `hookTimeout` went to 60 s (PGlite suites), and passed on rerun. Find the cause when the run engine adds more PGlite suites.
- [x] **P1.5 Event bus + WS hub.** (7477944..191fe02)
  - Postgres `NOTIFY` → WS fan-out with `since` resume.
  - `packages/client` store with TanStack Query integration.
  - Review notes from P1.5:
    - The `/ws` hub and HTTP `/rpc` are separate router instances; HTTP `events.subscribe` returns 501. Fine while all clients use `/ws`.
    - Shutdown order is tested through `createLiveEvents().stop()`, not a full `startServer` boot.
    - The one-off `@mawl/server#test` failure (2 files plus an unhandled error) did not reproduce in 8 runs. Same suspect as the P1.3b note: PGlite suites near `hookTimeout` under the parallel gate.
- [x] **P1.6 Web app shell.** (1f4d411..3213cee, merged in f872072)
  - tsconfig override for UI apps: `DOM` + `DOM.Iterable` libs, `jsx: react-jsx`, no `node` types. Relax `exactOptionalPropertyTypes` only where a library forces it (review note from P0.1).
  - Three-pane layout, theme (light/dark/system), and accent switcher wired to tokens.
  - Command palette and Motion presets.
  - Review note from P1.3b: provider settings follow OpenAI's SIWC UI guidelines: a "Continue with ChatGPT" button, a "Using ChatGPT plan" tag, "Manage usage" linking to https://chatgpt.com/settings/usage, and a "Usage limit reached" state. Show `reauthRequired` as a sign-in-again prompt. When `providers.delete` returns `revoked: false`, tell the owner to revoke access in ChatGPT settings. Same rules apply in onboarding (P8.1).
- [x] **P1.7 Chat UI.** (11e3832..d9ed15b; tester mutation-checked 18 behaviours, e2e 5/5; full parallel gate flaked on machine load, suites green alone)
  - Decided at slice start: chat needs a teammate, so the server implements `profiles.list/get/create/update/archive` now (plain CRUD, typed `SLUG_TAKEN` and `UNKNOWN_CREDENTIAL` errors) and the app gets a minimal "New teammate" dialog (name + model). The persona editor, color and avatar, clone and the teammate management UI stay in P2.1.
  - e2e: Playwright drives the Vite app against a dev-only server entry (`apps/server/src/e2e/serve.ts`, refuses to start without `MAWL_E2E=1`, never bundled) that boots its own Postgres container and answers every run with a scripted fake model. Locally Playwright uses the installed Edge (`channel: 'msedge'`); CI installs Chromium.
  - Streaming message list, composer (attachments later), and tool-activity cards (collapsed summaries).
  - Mascot state hook (SVG fallback) and empty states.
  - *e2e:* send a message → streamed reply (fake provider).
  - Note from P1.6: the web main chunk is 691 kB (225 kB gzip) after Settings was split off. Split the chat view and heavy vendors (Motion, cmdk) here if it grows.
  - Review note from P1.6: `createApi` (apps/web `src/api/create-api.ts`) drops the `createMawlClient` handle. Expose it through `Api` (or one module-level client) so the event store shares the same socket, start `createEventStore` with the app's `QueryClient`, and stop it on unmount.
- [!] **P1.8 Desktop shell.** Re-scoped into D1.4 (desktop host) by the 2026-10 redesign; the Tauri scaffold and the deep-link parser carry over. Paused mid-slice 2026-10-18: Tauri scaffold in apps/desktop (uncommitted or partly committed; check `git log` and `git status`), deep-link parser tests started. Decided: Sign in with ChatGPT desktop handoff moves to P6.1 (needs the authenticated device call). The UI half (server URL setting, notifications, deep-link navigation, external links) is not started. Tauri 2 wraps the web build: server URL setting, tray, notifications, single-instance, deep-link `mawl://`.
  - Review note from P1.3b: the desktop app owns the SIWC loopback flow and transfers the credentials to the server over an authenticated call. The VM or host keeps its own `ext_agent_host_id`.
- [x] **P1.9 Compose v1.** (895f4e3..adf5a49, merged in 0068726; stack verified booting at :7420. Note: the compose smoke test builds the image inside the default gate, about 1 min; move it to its own task if CI time bites) `server` + `db`. `docker compose up` gives a working chat at :7420 (the server serves the web build).
  - Review notes from P1.3b:
    - Publish `127.0.0.1:1455:1455` and set `MAWL_SIWC_BIND_HOST=0.0.0.0` inside the container, so the SIWC callback reaches the server.
    - Install `@anthropic-ai/claude-agent-sdk` as a production dependency for the image's libc (the native binary is about 290 MB). Keep it external to the esbuild bundle, and add a `claude` symlink so `docker compose exec server claude auth login` works.
    - Put `MAWL_CLAUDE_CONFIG_DIR` (`CLAUDE_CONFIG_DIR` for the binary) on a named volume.
    - Verify that headless `claude auth login` works in the container.

## U — Mawl UI redesign (see [UI-REDESIGN.md](UI-REDESIGN.md))
Goal: a comforting, playful, uncrowded UI on shadcn, with the new Mawl mascot, palette and sidebar. All slices are UI, so `head-coder`; read UI-REDESIGN.md, DESIGN.md and use all four design skills. Each slice is checked at 1440 / 1100 / 760 / 390 in light and dark.

- [x] **U1 Foundations.** (06f819a..780d876, merged in ec8d163; lint, typecheck and the web/ui/mascot tests green after the merge; the Docker-backed gate was not re-run, see the U7 sweep) shadcn init (Radix, Tailwind 4, components in `apps/web/src/ui/`), shadcn variables mapped onto `@mawl/ui` tokens, new Cream/Ink neutrals, the round shape scale, accent presets re-tuned with Lime as default, accent engine and contrast tests updated, `tokens.css` regenerated. Restyle the existing primitives (Button, Modal, Tooltip, EmptyState) on shadcn.
- [x] **U2 Mawl.** (d4e191f..499b9d1, merged in 179591e; agent ran the full gate green) Port the mint reference to a `Mawl` SVG component (8 states, pointer-follow, blink, reduced motion) and a simplified `MawlAvatar`; rename Pip and Beaver everywhere (code, `packages/mascot`, docs, copy); update `mascot-state` mapping and tests.
- [x] **U3 Shell and sidebar.** (33656d9..b51a790, fast-forwarded to main; typecheck, biome and 209 web tests green; browser pane too small for a full visual check, structure verified by DOM: 4 nav rows at 40 px, panel inset 8 px, Ink surface. Deferred: unread pill and Approvals count have no data yet (U5)) The new sidebar (Search, Tools, Scheduled, Approvals, Pinned, Teammates, Settings + profile), no icon rail: the sidebar hides completely with `Ctrl+B` and a header button, a drawer under 760 px (no bottom tab bar), the top row is the small Mawl plus the name "Mawl", pin and unpin teammates, the profile dialog UI (name, personal context; stored locally until U6).
- [x] **U4 Chat and composer.** (5783e14..0de3794; typecheck, biome, 221 web tests; looked at in headless Edge, desktop and phone, light and dark. Deferred: tool durations (no timings stored), Mawl `working` during a live run (stream carries text only), the sidebar "hides with the button" test is flaky under load, very short viewports clip the landing Mawl. AI Elements rejected: they assume AI SDK UIMessage data) New-chat landing, pill composer with `+`, model chip and a circular send / stop, message styling, tool activity and reasoning on AI Elements where they fit, Mawl in the header, the dock transition, loading / empty / error states.
- [x] **U5 Tools, Scheduled and Approvals pages.** (d1745ce..b0918d0; typecheck, biome, 237 web tests; the old Connections page was an empty placeholder, so all three tabs are designed empty states; also did the mascot cleanup and the custom scrollbars) Tools (Connections, Skills, Plugins tabs), Scheduled, Approvals with the Activity tab. Pages may show real data where the server has it and a designed empty state where it doesn't yet; each one names the D-slice that fills it.
- [x] **U6 Settings and profile.** (c3b8aa3..9f6885e; migration 0006 `user_profile`; regular reviewer found no blockers, its fixes landed in U7; Testcontainers twin not run) (hard: contract) Sectioned Settings, the Appearance redesign (theme, accent swatches, reduced motion), and the `user` profile RPC (name, personal context) with a server store. Propose head-reviewer (contracts change).
- [x] **U7 Workspace panel and sweep.** (1f5c39c..cb4d446; 281 web tests; screenshot sweep at 4 widths x light/dark looked at by the coder and the orchestrator; the 1100 and 760 Tools/Approvals/Settings shots pre-date the `sm:` fix; full Docker gate not run) Restyle the right panel (Computer, Memory, Files, Run placeholders), teammate dialogs and the command palette; then the full responsive and theme sweep, a11y pass, and screenshots for the user.

## D1 — Desktop host (install and go)
Goal: download the installer, open Mawl from the tray, chat with a teammate. No Docker, no terminal. See REDESIGN §4.

- [x] **D1.1 Embedded Postgres lifecycle.** (2137c4a..462656f; 117 unit tests green, real-binary suite 8/8 run by the coder on Windows; reviewer found 2 majors, fixed; full Docker gate not run) (head-coder: process lifecycle and concurrency)
  - A server module owns the bundled EDB Postgres 17.10:
    - first run: `initdb --no-sync` into a staging dir, then rename it into place
    - spawn `postgres` on a free 127.0.0.1 port with a generated password under the data root
    - poll until ready; `pg_ctl stop -m fast -w` on shutdown
    - never `detached`; read exit codes only (localized output)
  - Add `infra/desktop/fetch-pg.ps1`: hash-pinned EDB zip download, prune the pgAdmin DLLs.
  - *Tests:* cold and warm start, clean stop leaves no recovery on the next start, a killed server leaves Postgres recoverable, port collision, a corrupt or missing data dir gives a typed boot error. Windows-only suites skip elsewhere and are required on the Windows CI job.
  - *As built:*
    - `apps/server/src/embedded-pg`: `startEmbeddedPostgres({ pgRoot, dataRoot, logger? })` returns `{ port, connection, connectionString, cold, exited, output(), stop() }`. Not wired into config or main yet (D1.3).
    - Data root layout: `cluster\` (PGDATA) and `password` (256-bit base64url). First run: initdb (`--no-sync --no-locale --encoding=UTF8 --auth=scram-sha-256 --username=mawl`, password via a pwfile deleted afterwards) into `cluster.staging-<id>`, then `initdb --sync-only -D <staging>` (a failure only warns), write `password`, then rename (retried on Windows EPERM/EBUSY). Syncing before the rename keeps a committed cluster durable across a power loss. Stale staging dirs and pwfiles are deleted once per boot; cleanup errors never mask `initdb_failed`. An existing but incomplete `cluster\` is never re-initialised. Two server instances on one data root are unsupported (single instance is D1.5).
    - Any unexpected throw after postgres is spawned (probe, clock, output) stops it and becomes `start_failed`, as does a synchronous spawn failure.
    - App database `mawl`, created on every start if missing. `--no-locale` keeps `lc_messages=C`, so Postgres logs are English, but no logic parses them.
    - Port race: when Postgres exits during start and the port is now taken, retry on a new port (3 attempts, then `port_unavailable`). A password rejection gets a 1.5 s grace so a foreign server on a lost port is not blamed on the data dir.
    - Stop: `pg_ctl stop -m fast -w -t`, exit code only; on failure, a hang, or Postgres outliving pg_ctl, `child.kill()`. `stop()` is idempotent; `exited` reports `expected: false` for an unexpected death.
    - Boot errors (`EmbeddedPgError.code`): `binaries_missing`, `initdb_failed`, `data_dir_corrupt`, `port_unavailable`, `start_timeout`, `start_failed`, with an output tail in `detail` for diagnostics.
    - `infra/desktop/fetch-pg.ps1 -Dest <dir> [-Zip <cache>]`: the zip is 318 MiB (mostly pgAdmin), hash-pinned; extracts only `bin`, `lib`, `share` and the licenses, keeps `initdb`, `postgres`, `pg_ctl`, `pg_controldata` plus all runtime DLLs, and drops wxWidgets, `.lib`, `pgxs`, `share\locale`. About 74 MB. Idempotent through a marker file, assembled in a staging dir.
    - Real-binary suite `embedded-pg.win.test.ts` runs with `MAWL_PG_ROOT=<fetch-pg dest>` on Windows and fails when `MAWL_REQUIRE_EMBEDDED_PG=1` (set it on the D1.2/D1.7 Windows CI job). Both vars are in turbo `globalEnv`. Local timings: cold start (initdb + sync + start) 7.5 s, warm start 0.38 s.
    - `fetch-pg.ps1` swaps an old `-Dest` aside to `-Dest.old` and restores it on failure; curl is HTTPS-only, redirects included.
    - Follow-ups: a postmaster.pid whose PID was reused after a hard kill makes Postgres refuse to start (`start_failed`); Postgres refuses to run elevated (an admin-launched Mawl gets `start_failed`).
- [x] **D1.2 pgvector Windows build in CI.** (bc375e4..2b1aa4d; the MSVC job is green on PR #5: pgvector `installcheck` 14/14, `vector.dll` built.) *Lessons from the first runs:* the runner is an administrator and `postgres.exe` refuses that, so the scratch server starts through `pg_ctl start` (restricted token); `Start-Process -Wait` hangs because it waits for `postgres.exe`, so use a timed `WaitForExit`; `pg_regress` needs the staged `bin` on PATH. Also fixed in this PR: `@mawl/web` tests failed on cold CI runners (1 s `findBy` and 10 s hook defaults), so `asyncUtilTimeout`, `hookTimeout` and `testTimeout` were raised. *As built:* `.github/workflows/pgvector-windows.yml` (path-filtered to `infra/desktop/**`, plus manual dispatch) runs `infra/desktop/pgvector/build-vector-msvc.ps1`: pinned zip and `postgres.exe` hashes, pgvector tag plus commit check, MSVC env via vswhere, `nmake` build, install, `installcheck` on a scratch trust-auth cluster, then `vector.dll` + control + SQL + `SHA256SUMS.txt` uploaded. Checked by `scripts/pgvector-workflow.test.ts`. Job spec:
  - download the EDB zip and check its hash; assert its `postgres.exe` matches
  - build pgvector v0.8.7 with MSVC (`nmake /F Makefile.win`) and run `installcheck`
  - upload `vector.dll` + control + SQL as a hashed artifact
  - The MinGW recipe stays the local fallback. Actions pinned by full SHA (existing test).
- [x] **D1.3 Desktop server mode.** (7774f1f..20a8ae9; review and head-review fixes included; scoped server tests only, no Docker or full gate; the Claude binary and SDK bundling moved to D1.3b, enforcing the token on `/rpc` and `/ws` is D1.4, placing `vector.dll` under `pg\` is D1.7) (head-coder: server boot, DB lifecycle, secrets handling; split 2026-10-22)
  - *As built:* `config.ts` adds `MAWL_MODE` (default `headless`), `MAWL_DATA_DIR` (desktop, absolute; secrets default to `<data>/secrets`, the cluster to `<data>/pg-data`) and `MAWL_PG_ROOT` (desktop without `DATABASE_URL`); headless ignores both. `launch-token.ts` reads stdin's first line (base64url 32-512, 1 KiB cap, 15 s) and doubles as the parent watchdog; `run-main.ts` holds the entrypoint with injected process pieces; `registerSecretValue()` censors the token in every log line. `startServer` starts the embedded Postgres after the secrets and stops it last, also on a failed boot or shutdown step. SIWC port/bind and the Ollama default were already right (pinned by existing tests). Review fixes: an emergency Postgres stop (3 s, never throws) before every hard exit 1 (fatal error, deadline, second signal), every teardown step runs even when one fails, stdin bytes after the token line are kept in `remainder()`, and an explicit `MAWL_SECRETS_DIR` must be absolute in desktop mode. Head-review fixes: stdin EOF during a shutdown only logs (only a second real SIGINT/SIGTERM escalates), desktop `MAWL_HOST` must be loopback (`127.0.0.1`, `::1`, `localhost`), and the real-process watchdog test logs the token on purpose to prove its redaction.
  - Config: `MAWL_MODE=desktop|headless`, `MAWL_DATA_DIR` (Tauri's `app_local_data_dir`, `%LOCALAPPDATA%\app.mawl.desktop`, never the install dir). `DATABASE_URL` is optional in desktop mode, which uses D1.1 with binaries from `MAWL_PG_ROOT` (the install's `pg\`).
  - Port via env, launch token on stdin's first line, never argv. Exit on stdin EOF (parent watchdog; D0.2 saw the server ignore EOF today).
  - SIWC callback on the real loopback; the Ollama default `http://localhost:11434`.
  - *Tests:* config matrix, watchdog exit, no token in logs.
- [x] **D1.3b Bundled Claude binary.** (80b0f62..78310ae; reviewer and test-author fixes included; scoped server checks only: 108 claude-binary tests, typecheck, biome, build; real 132 MB download smoke-tested on win32-x64; no Docker or full gate, Docker image untested; head-review not run) (split from D1.3)
  - Build: bundle `@anthropic-ai/claude-agent-sdk` JS into `server.mjs` (drop it from esbuild `external`) and always pass `pathToClaudeCodeExecutable`.
  - The Claude binary on first use: download the pinned platform package tarball, verify the lockfile sha512, extract to `<data>\claude\<ver>\`. Never modified (Anthropic terms).
  - *As built:* `build.ts` parses `pnpm-lock.yaml` (`claude-binary/manifest.ts`: version, https tarball url and sha512 per platform) and embeds it with `define` as `__MAWL_CLAUDE_MANIFEST__`; from source there is no manifest and nothing downloads. `claude-binary/ensure.ts` `ensureClaudeBinary()`: streams the tarball into `<data>\claude\.download-*` (400 MB cap, 10 min timeout, abort), compares its sha512 with the pin, and only then reads it with `tar` 7.5.22 (BlueOak-1.0.0): it writes `package/claude(.exe)` alone to `<ver>.staging-*` (unsafe paths, links, a duplicate or an oversize binary fail the install), writes a `.verified` marker holding the integrity, and renames into `<ver>`. A present binary with a matching marker returns with no network or hashing. Calls share one flight per install (the download aborts only when every caller has aborted), and leftover `.download-<ver>@*` / `<ver>.staging-*` of the same version are swept at the start of an install (other versions' files are never touched). Typed `ClaudeBinaryError` codes: `unsupported_platform`, `download_failed`, `download_too_large`, `integrity_mismatch`, `extract_failed`, `aborted`. `claude-binary/resolver.ts` picks the executable: `MAWL_CLAUDE_CODE_PATH`, else (desktop with a manifest) the data-dir install, downloading it if needed, else core's `resolveBundledClaudeBinary()` (the Docker image's platform package). The seam is `ProviderService`'s new `claudeCode.resolveExecutable`, awaited only when a Claude plan credential is tested or turned into a model (never at boot); a failure is `unreachable` on test and `provider_error` on `createModel`, logged by error name and code only. No `@mawl/core` or `@mawl/contracts` change. Checked live once on win32-x64: 132 MB in 3.8 s, binary reports `2.1.302`.
  - *Review fixes:* a call that arrives after the last waiter aborted waits for the dying install and starts a fresh one; the `.verified` marker is JSON `{integrity, size}` and the installed path must be a regular file of that size; untyped fs errors become a generic `extract_failed`; `rm`/`rename` of the version dir retry EPERM/EBUSY/EACCES (50-1000 ms backoff); content-encoded responses skip the content-length check (the sha512 still catches truncation); manifest versions are directory-safe (`[0-9A-Za-z.+-]`, no `..`); the lockfile reader accepts extra `resolution` fields; the tarball entry count is capped (10 000; inflation is bounded by tar's decompression-ratio guard and the download cap); a headless lookup that finds nothing logs a warning; `ProviderService.abortPending()` (also run by `close()`) aborts downloads in flight, and `stop()` calls it before the run worker stops; a test ties the Dockerfile's SDK pin to the lockfile. The sweep of leftovers assumes one server per data dir (desktop mode allows a single instance).
  - Follow-ups: the first "Test" of the Claude plan downloads ~126 MB and can wait up to the 10 min timeout, so D1.8 (onboarding) needs a pre-download step with progress (`onProgress` already reports `download`, `verify` and `extract` with byte counts) before the owner reaches that click; a Tauri-driven pre-download can call the same function.
- [x] **D1.4 Local launch-token auth.** (839d89a..bb24210, review fixes included; this range line was set in the commit after it; scoped package tests only, no Docker suites, no Playwright run, no full gate) (head-coder; security. Propose head-reviewer)
  - *As built:* `/rpc` needs `Authorization: Bearer <token>`, `/ws` the subprotocols `mawl.v1` + `mawl.token.<token>` (server echoes `mawl.v1` only); sha256 + `timingSafeEqual`; order Host, Origin, token; missing and wrong both 401 with one generic answer; never read from a url. Desktop uses the stdin launch token (boot fails without it); headless uses `MAWL_OWNER_TOKEN` or a generated `<secrets>/owner-token` shown once on stderr. `createApp`/`attachWsHub`/`createMawlClient` require the token. `/rpc` bodies capped at 1 MiB (413). `events.subscribe` needs the owner principal and scopes topics with `scopeTopics`. `providers.test`: SSRF guard (resolve once, pinned connect, blocked ranges always refused, private only for stored credentials or with the additive `allowPrivateNetwork` flag; new failure `blocked_address`), token bucket 10 + 1/3 s (typed `RATE_LIMITED` 429). Review fixes: IPv4-compatible `::a.b.c.d` read as IPv4; 6to4, Teredo, `64:ff9b:1::/48`, documentation ranges and Azure's 168.63.129.16 blocked; 192.0.0.0/24 and 198.18.0.0/15 private; a test pins `redirect: 'error'` on default and guarded urls; the dialog has its own rate-limit line. Web: `OwnerTokenGate` (launch token, sessionStorage, typed token checked with `health.get`), the Add dialog asks before a private address. e2e and compose use a fixed or generated owner token. Contracts additions: `auth.ts` constants, `ProviderTestInput`, `blocked_address`.
  - Decision (review #3, kept): a stored credential keeps private-network access for its checks, because the owner saved that address; an unsaved one needs `allowPrivateNetwork`. Link-local, metadata and the other blocked ranges are refused for both.
  - Follow-ups: guard run-time model calls to a stored base url the same way (today only `providers.test` is guarded); a Settings toggle for private addresses if the dialog prompt is not enough.
  - Every `/rpc` call and the `/ws` upgrade require the per-launch token, in a header or the WS subprotocol, never in a URL. It's checked in constant time, on top of the Host and Origin checks.
  - Headless mode uses a generated owner token until device auth (D8.1).
  - Review notes from P1.2/P1.3/P1.5, carried over:
    - add a request body size limit on `/rpc`
    - scope `events.subscribe` topics to the owner
    - `providers.test` with an inline input is an SSRF oracle: block link-local/metadata ranges (169.254.0.0/16, fd00:ec2::/32), resolve DNS once and pin the IP, allow private ranges only via an explicit owner opt-in (Ollama on the LAN), rate-limit `test`
- [~] **D1.5 Tauri host.** (head-coder: UI + process supervision; old P1.8) Split 2026-10-22 into two slices, each one PR:
  - [x] **D1.5a Supervisor and launch.** (eb124e8..d936284, reviewer and test-author fixes included; scoped Rust, splash, server and desktop checks only; no `tauri build`, real boot with Postgres, Docker, e2e or full gate; head-review not run; the ACL for remote origins is proven from config, not at runtime, which belongs to the D1.7 Windows CI) Everything under "Supervisor", the host contract, the token injection, the CSP, single instance, a splash with a boot/failed/restarting state and a clean "Quit Mawl". Tests: Rust state-machine unit tests.
    - *As built (head-coder, not yet reviewed):* see ARCHITECTURE "Desktop host". The logic is the Tauri-free crate `apps/desktop/src-tauri/host` (`mawl-host`: state machine, driver, process + job object via `windows-sys` 0.61.2, token via `getrandom` 0.3.4, env allowlist, diagnostics ring, `/healthz` probe over a raw socket, port memory, navigation and token-script rules, and the deep-link parser moved there); `src/shell.rs` wires it to Tauri. The app loads from the server's origin (`http://127.0.0.1:<remembered port>/`); the splash is a second Vite entry (`apps/web/splash.html`, `src/splash/`) served from Tauri's origin. CSP on both. Review fix loop 1: a token on the 64 KiB output split stays whole; the splash ignores a late status snapshot and recovers from a refused Try again or Quit; the host commands are under the ACL with a local-only capability (the app page, a remote origin, can call none); pop-ups are refused; `/healthz?n=<nonce>` returns an HMAC identity proof (`apps/server/src/health-identity.ts`), and the host opens the app only for a server that gives it (`hmac` 0.12.1, `sha2` 0.10.9). Tests: 60 Rust unit tests and 37 integration tests in `host/tests` (4 against a fake server on `node`: ready + clean quit through stdin, crash restart, missing install, the job ending a grandchild; the rest from the test-author); web splash 34; server `web-static`, `web-csp` and `health-identity`; desktop config and ACL 8. The ACL is checked statically (manifest, handler list and capability in step, no `remote`) against Tauri's rule, not by a running app. Not run: `tauri build`, an installed layout (D1.7), a real boot against embedded Postgres through the host, any Docker suite or the full gate. A debug `mawl-desktop.exe` was started once and seen spawning `node` on `server.mjs` and restarting it.
    - *Follow-ups:* the splash cannot see the owner's theme or accent (they live in the app origin's localStorage); external links in the app are blocked by the navigation rule until D1.5b opens them in the browser; the app page has no IPC, so deep-link navigation (D1.5b) needs another route, such as a `remote` capability scoped to the app origin, or the host navigating the window; `externalBin` is added in D1.7 (tauri-build requires the file at build time); a restart takes the owner from the app back to the splash and the page reloads.
  - **D1.5b Shell polish.** Split again, each slice one PR. Decided: the app page never gets IPC. *Changed 2026-10-22:* the earlier plan of host to server to `/ws` is not built, because the host sees what it needs itself (links, power and session events). A server to host stream waits until the server has something native to say (D1.5b2c).
    - [x] **D1.5b1 Shell polish, host-only half.** (985572e..be2b53d; scoped Rust, desktop config/ACL and biome checks only; head-review of D1.5a ran first and its fixes are in; reviewer approved with minors; the tray, login item, notifications and hidden launch are not run on a real Windows desktop; app icon drawn in code at the user's request) Starts with the D1.5a head-review fixes: the enter/leave-app race (`presence.rs`: readiness and in-app behind one lock), the app origin loads only while the supervisor is Ready, and only `/splash.html` is allowed on the local origin. Then: tray icon, tooltip and status line follow the supervisor (a status dot on the app icon until the mascot art exists, `// TODO(mascot)`); tray menu with "Start Mawl at login" (on at first run only, never in dev builds, reflects the OS state); one "Mawl is still running" notification on the first close to the tray; a login launch (`--autostart`) stays hidden in the tray; native notifications for a final failure and for a return after an outage over 30 s while hidden. No change to `apps/web`, `apps/server` or the contracts. Tests: Rust unit tests in `mawl-host` (`presence`, `tray`, `markers`, `autostart`, `notice`); the desktop ACL test also asserts no `remote` key and no wildcard-port origin. Not verifiable without a human on Windows: the real tray, the login item and native notifications.
    - **D1.5b2 Shell polish, links and session.** Split 2026-10-22 into three slices.
      - [x] **D1.5b2a Host links and session.** (PR #16, merged) External links open in the browser (`http`/`https` only, loopback and userinfo refused, 500 ms limiter); deep links navigate the main window from the host (pending until the server is ready), and the dead `mawl://navigate` event and `take_pending_navigation` command are gone; a clean server stop at Windows logoff or shutdown (`WM_QUERYENDSESSION` / `WM_ENDSESSION` through a window subclass, shutdown block reason); a health probe at once on wake from sleep. Also three D1.5b1 review minors: the autostart marker is released when `enable()` fails, a failed launch starts the outage so a later retry says "Mawl is back", and a failed first-close toast releases its marker. Host to server channel dropped (see D1.5b). Not verifiable without a human on Windows: a real logoff or shutdown, a real browser open, a real deep link, sleep and wake.
      - [x] **D1.5b2b Remote Mawl and polish.** (e7872e8..861e9f5; scoped checks only: mawl-host cargo tests and clippy, web splash vitest, targeted server vitest, biome and typecheck; reviewer, test-author and a scoped head-review ran and their fixes are in; not run on a real Windows desktop: Credential Manager, TLS, the 15 s re-check thread, the tray) "Connect to a remote Mawl": a window target (`<data>\window-target.json`, origin only) and the remote's owner token in Windows Credential Manager (`Mawl/remote-token`), entered on the splash's form; `https` only unless the address is loopback; the host saves nothing until `/healthz` answers with the identity proof v2, which binds the nonce and the origin the client used (server and host together, the local supervisor probe too; a 503 needs the proof as well), and re-checks a remote shown in the window every 15 s. The `onSpawn`/abort hook for `startEmbeddedPostgres`; splash theming from the owner's appearance kept in the host data dir (`appearance.json`); tray copy for a remote. A restart still returns the window to the splash: the held app page was built and dropped after the head review (it reconnected to the old origin with the token and nothing verified who answered), so the reconnecting banner moved to D1.5b2d. D1.5b1 review minor folded in: the presence thread test overlaps. See ARCHITECTURE "Desktop host" (*Remote Mawl*, *Splash appearance*).
      - [ ] **D1.5b2d App-wide reconnecting banner with a client-side proof check.** Keep the app page through a server restart instead of reloading through the splash: the web client shows a reconnecting banner and, before every reconnect that carries the token (`/ws` subprotocol, `Bearer` on `/rpc`), asks `/healthz` for the proof v2 for its own origin and only reconnects on a valid one (the client needs the token to verify, so the check runs in the page). The host then holds the page instead of navigating to the splash, and moves it when the port changed. Covers this PC's server and a remote Mawl.
      - [ ] **D1.5b2c Server to host stream.** Native notifications that come from the server (approvals, finished runs): a server to host channel authorized by the launch token, built only when the server has events worth a notification.
  - Supervisor: spawn `mawl-server.exe` (renamed `node.exe`, Tauri `externalBin`) on `server\server.mjs` with `std::process::Command` (no shell plugin), `env_clear()` plus an allowlist, `CREATE_NO_WINDOW`, a kill-on-close job object, and stdin held open (token on the first line). Wait for `/healthz`, restart with backoff (5 in 5 min, then an error screen with "copy diagnostics").
  - Splash, tray with the mascot state, close-to-tray, "Quit Mawl" (clean shutdown of server and Postgres), autostart at login (on by default, toggle), single instance, deep links `mawl://` (the parser exists), notifications, power events (the host probes the server itself; nothing is forwarded, see D1.5b).
  - Host contract with the server (from the D1.3 head review):
    - Keep the server's stdin open for its whole life: EOF is the parent watchdog and stops it.
    - Graceful quit: close stdin, then wait at least ~25 s (the 10 s shutdown deadline plus up to 15 s of `pg_ctl stop`) before the kill-on-close job object takes the tree down.
    - Restart the server when `/healthz` answers 503: if its Postgres dies, the server logs it and keeps running; it never exits on its own.
    - Create the Windows job object. It also covers Rust `std` spawn handle inheritance, which can keep the stdin pipe open in another child and hide the parent's death.
    - From D1.4: inject the launch token into the webview as `window.__MAWL_LAUNCH_TOKEN__` with an initialization script (before any page script runs), never in the url; the web app's `OwnerTokenGate` then opens without asking.
  - From the D1.4 review (#6): a Content-Security-Policy for the web app, both the Tauri webview config and the headers `web-static.ts` sends (today only `frame-ancestors 'none'`), so an injected script cannot read the launch token from `window` or sessionStorage.
  - Follow-up from D1.1 (D1.3 head review): add an `onSpawn`/abort hook to `startEmbeddedPostgres`, so the emergency stop can be registered before the readiness wait (initdb or WAL recovery can take up to 60 s). Today it is registered only once Postgres is ready.
  - Advanced: "connect to a remote Mawl" instead of the local server.
  - Review note from P1.3b: the desktop app can run the SIWC loopback flow itself; with the server on the same host, the server-side flow is enough for v1.
  - *Tests:* supervisor state machine (Rust unit tests), deep links, e2e boot on the Windows CI job.
- [x] **D1.6 Master key in Windows Credential Manager.** (6a6bff0..e5e3f30; scoped Rust, server typecheck, biome and the touched vitest files only; no Docker suite, full gate or e2e; head-review not run; the real Credential Manager is not exercised: run `cargo test -p mawl-host -- --ignored` once on Windows) (head-coder: secrets)
  - Desktop mode keeps the master key in Credential Manager. The host reads it and passes it to the server over stdin. The file in `secrets/` stays for headless mode.
  - The key arrives on the stdin line after the launch token. `readLaunchToken()` keeps those bytes in `remainder()` today (up to 64 KiB, nothing parses them yet). Replace it with a one-shot `takeRemainder()` that hands the bytes over, detaches and zero-fills the internal buffer, and stops buffering after the first key line; parse it with a timeout.
  - Never hold the master key as a `Buffer` in an object that may be logged: `redactDeep` only scrubs strings and `registerSecretValue` only accepts strings, so register the key's string form and keep the bytes out of log calls.
  - Migrate an existing file key once, then delete the file only after a verified decrypt.
  - *Tests:* round trip, migration, wrong key aborts boot (existing rule).
  - *As built.* Stdin is two lines: token, then the key as 43 base64url characters (`secrets/host-key.ts`, `HostKeyError` `missing`/`invalid`/`timeout`, 15 s). `takeRemainder()` is one-shot, keeps at most 1 KiB of the key line in a fixed buffer and zero-fills it and every stdin chunk. The host (`master_key.rs`, `KeyStore` trait, `CredentialManager` on `CredReadW`/`CredWriteW`, target `Mawl/master-key`, `CRED_PERSIST_LOCAL_MACHINE`) uses the stored key, else imports `<data>\secrets\master.key`, else generates one; a new entry is read back and compared before it is sent. The server keeps the deletion decision: an existing `master.key` that differs aborts boot (neither key changes); after migrations `providers.verifyMasterKey()` must decrypt one stored secret, or boot aborts with `MasterKeyError`; only then (or with nothing stored yet) is an equal file deleted. "Wrong key aborts boot" was not an existing rule (a wrong key used to surface only as `CREDENTIAL_UNREADABLE` per credential); it is new and desktop-only, headless is unchanged.
  - *Follow-up (needs a product decision):* when the Credential Manager entry is lost and no backup exists, boot stops for good, because the old provider keys stay in the database and fail the decrypt check. An explicit, owner-confirmed way to drop the unreadable provider keys and boot without them (for example a marker file or a recovery screen on the splash) is not built.
  - *Not verified automatically:* the real Credential Manager calls (tests use `MemoryStore`, so no run touches the developer's credentials). Check by hand on a Windows desktop: first run creates `Mawl/master-key`, a second run reuses it, an install with an old `master.key` migrates and the file disappears after the first boot.
- [ ] **D1.7 Installer, updater, Windows CI.**
  - Tauri NSIS per-user bundle (`bundle.useLocalToolsDir: true`) with the sidecar, `server.mjs`, `drizzle\`, the web build, the pruned Postgres bundle, `vector.dll` and the app-local VC++ runtime (`VCRUNTIME140`, `VCRUNTIME140_1`, `MSVCP140` in `pg\bin`). Budget: installer ≤ 60 MiB (D0.2 measured 46.35).
  - Release builds on MSVC in CI (sidecar suffix `-x86_64-pc-windows-msvc`); local dev may use the `-gnu` host. Updates need the job object (D1.5) so the sidecar and Postgres are gone before files are replaced.
  - Tauri updater against GitHub Releases (signing keys in CI secrets, owner's call), and a size budget check.
  - The compose image smoke test moves out of the default gate into its own task (note from P1.9).
- [ ] **D1.8 First-run onboarding.** (head-coder: UI; old P8.1)
  - Splash while the DB prepares → provider (Continue with ChatGPT first, per the SIWC UI rules recorded in P1.6; API key; Ollama detection; Claude plan) → name your first teammate → chat.
  - Claude plan: a "Sign in" button opens a terminal running `claude auth login` with Mawl's config dir (Anthropic's own flow), then re-checks `claude auth status`.
  - Loading, empty, error and success states; works at 390 px.

## D2 — The agent loop
Goal: one loop, every provider: tools, policy, approvals, steering, skills, MCP, subagents and a crafted prompt. See REDESIGN §5.

- [ ] **D2.1 Prompt assembler + blocks.**
  - Versioned blocks in `packages/core/prompts/`: identity, rules, tools, computer (conditional), persona, skills-index, memory-core, environment. Ordered stable to volatile, with cache breakpoints.
  - Mawl writes its own prompt text, including the "page text is data" and "never kill display or browser processes" rules.
  - Align MEMORY.md §7 (server rule: a prompt layout change updates MEMORY.md §7 and the snapshot tests).
  - *Tests:* snapshot per configuration; byte-stable prefix across steps.
- [ ] **D2.2 Tool registry + built-ins.** `web_fetch`, `web_search` (pluggable), `ask_user`, `notify`, `read_artifact`. Artifacts for outputs over 4k tokens.
  - Review notes from P1.4:
    - `executeRun` passes `deps.tools` straight to `streamText`; every call must go through the policy engine (D2.3) first.
    - A crash between a tool's side effect and the step write re-runs the tool on resume, so tools need idempotency keys (`run_id`, `step_idx`, `toolCallId`).
    - Wrap tool results as untrusted data.
- [ ] **D2.3 Policy engine.** Action classes, levels, rule precedence, and the non-lowerable classes. *Tests:* a table-driven rule-matrix test. (Propose head-reviewer.)
- [ ] **D2.4 Approvals.** (head-coder: run engine + policy)
  - `waiting_approval` releases the worker. The parked call is stored encrypted with its arguments hash, and approve replays it byte for byte (R9). A denial is returned to the model.
  - Approvals inbox UI, an inline approval card in chat, resolution events.
- [ ] **D2.5 Run inbox: steering + follow-ups.** (head-coder: run engine)
  - `run_inbox`: user messages during a run and system follow-ups, injected at the next step boundary.
  - A truncated tool call (finish `length`) is failed, never executed. A capped `finishTurn` hook.
  - Decide one run at a time per thread (note from P1.4: two runs on the same thread both read the same history). A message to a busy thread steers it.
- [ ] **D2.6 Fallback models.** A per-profile ordered list. On `temporarily_unavailable` or `plan_limit_reached`, the next step uses the next model; the switch is recorded and shown.
  - Note from P1.3b: a Claude `rate_limit_event` with status `rejected` is a hard failure today, even when overage may be allowed; revisit when overage info is reliable.
- [ ] **D2.7 Subagents (`delegate`).** A child loop inside the parent's turn, with a tiny prompt; it can't talk to the user and can't delegate again. Budget carved from the parent's; one report back.
- [ ] **D2.8 Skills.** (old S4 core)
  - `skills` table, the `SKILL.md` format, the index block, `skill_load`, `skill_propose` into an approval queue.
  - Skills UI (list, editor, proposals). UI → head-coder.
- [ ] **D2.9 MCP manager + tool search.** (old P2.5)
  - HTTP/SSE servers with OAuth (`@ai-sdk/mcp`), a per-profile enable list, per-tool policy, a Connections UI, and a curated catalog JSON.
  - Above 30 tools, MCP tools are deferred behind `tool_search`.
  - Stdio servers come with computers (D3.5).
- [ ] **D2.10 Claude plan bridge.** (head-coder: providers + run engine; REDESIGN §5.6)
  - Mawl tools via `createSdkMcpServer`, every handler through policy and step recording.
  - Steering through streaming input (verify), approvals waiting inside the handler with a timeout that becomes a denial, and a "limited" label in the UI.
  - Deferred from D1.3b (owner decision 2026-10-22): the Claude binary must be installed only on an explicit "Install Claude Code" click, never silently on the first Test or run. Until the owner installs it, testing or using the Claude plan fails with a typed "not installed" error. Offer "use my own Claude Code": detect `claude` on PATH or pick its path in Settings, and use it instead of downloading (today only `MAWL_CLAUDE_CODE_PATH` does this). The install action shows progress (`onProgress`). Headless/Docker keeps using the SDK package in the image.
- [ ] **D2.11 Teammates UI.** (old P2.1; head-coder: UI) Persona editor, color and avatar, main, helper and fallback models, clone and archive, a computer slot (filled by D3).
- [ ] **D2.12 Activity feed + audit log UI.** (old P2.6) Filterable by profile, type and time.
- [ ] **D2.13 Loop eval set.** About 20 fixed tasks (fake model in CI, real model by hand), scoring tool choice, approvals respected, steering honoured and prompt-injection resistance.

## D3 — Computers
Goal: give a teammate a terminal or desktop computer with one click, when Docker Desktop is installed. See REDESIGN §6.

- [ ] **D3.1 Computer images.** `infra/computer/`: `mawl-computer-terminal` (under 500 MB) and `mawl-computer-desktop` (builds on terminal, under 1.6 GB), with the `computer-agent` helper (JSON-RPC over stdio). Published to GHCR by digest; image smoke test in CI.
- [ ] **D3.2 Computer entity.** (head-coder: migration + contracts) `computers` table, nullable `profiles.computer_id`, contracts and RPC (`computers.list/create/attach/detach/reset/archive`), `computer.status` events.
- [ ] **D3.3 DockerProvider + engine detection.** `dockerode` over the Windows named pipe (headless: socket proxy). Engine `not_installed | not_running | ready`, image pull with progress, `ensure`, `suspend`, `reset`, idle auto-suspend, home volumes.
- [ ] **D3.4 Exec transport.** (head-coder: sandbox boundary) `attachStdio` for helper RPC, stdio MCP and the VNC tunnel. No published ports, no container IPs, no host mounts. *Tests:* a computer cannot reach Postgres, the engine or the API.
- [ ] **D3.5 Computer tools.** `shell` (with background jobs that post follow-ups to the run inbox), file tools, browser via Playwright MCP (headless or headed), `computer_screenshot`, `computer_act` (desktop kind), plus stdio MCP servers inside the computer.
- [ ] **D3.6 Docker UX + computer card.** (head-coder: UI) Per engine state: copy and action (install link, "start Docker Desktop", pull progress). Create, attach, share, reset and wipe flows.
- [ ] **D3.7 Screen gateway + computer panel.** (head-coder: UI) Ticketed WS proxy over the exec tunnel (view/control capabilities, tickets in the subprotocol header), a noVNC RFB component, Watch / Take control / Give back, lease timer, the agent's "cursor ghost".
- [ ] **D3.8 Takeover + input lease.** `waiting_takeover`, `request_takeover`, a per-computer input lease (agents per batch; the user outranks), notifications, the resume note to the agent.
- [ ] **D3.9 Credential form.** Secure type-into-computer, with a redacted audit. (Propose head-reviewer.)

## D4 — Memory system (see MEMORY.md)

- [ ] **D4.1 Memory schema + core blocks.**
  - Blocks with caps and versions, `memory_block_edit` tool, frozen-per-segment rendering.
  - *Tests:* cap rejection; byte-stable prefix across edits.
  - Decide the user block cap: profile context allows 2000 chars, the block caps at 1500 (see MEMORY.md).
- [ ] **D4.2 Episodic log + `session_search`.** Episodes with FTS and artifact references.
- [ ] **D4.3 Embedder + hybrid recall.**
  - Pluggable embedder, HNSW, RRF + rescoring + MMR, automatic injection.
  - *Tests:* the ranking math, plus a fixture corpus with expected top-k.
- [ ] **D4.4 Fact extraction (warm path).** Extract → compare → ADD/UPDATE/INVALIDATE/NOOP, bi-temporal, injection scanner, `memory_ops` audit. Includes the golden set.
- [ ] **D4.5 Compaction ladder.**
  - Review note from P1.4: resolve `contextWindow` per model id here.
  - L0–L3 with thresholds, pre-flush, checkpoints, segment rollover, and native Anthropic context editing when available.
  - *Tests:* survival ≥ 95%.
- [ ] **D4.6 Sleep-time consolidator.** Dedupe, re-densify, digests, decay, and a "what changed overnight" record.
- [ ] **D4.7 Memory UI.** Blocks, facts table, timeline, skills, history and undo, "used memories" on messages.
- [ ] **D4.8 Long-horizon eval harness.** A simulated 3-day workload and a metrics report (runs nightly in CI with the fake model, manually with a real one).

## D5 — Schedules and always-on
Goal: teammates work on their own, reliably, on a laptop that sleeps. See REDESIGN §7.

- [ ] **D5.1 Background runs UX.** (old P5.1) Pause, resume and cancel from anywhere, plus "Pause all teammates".
  - Review notes from P1.4:
    - Add a stale-run sweeper. A run stays `running` with no job after Graphile exhausts its 5 attempts on infra errors, after an enqueue failure right after `runs.start`, or after 30 resume requeues; today only boot recovery picks it up.
    - A deterministic non-provider error from `createModel` retries 5 times before that; fail it as `internal_error` on the last attempt.
- [ ] **D5.2 Routine engine.** (head-coder: jobs)
  - Triggers: cron, RRULE, interval and one-shot, with a timezone and `next_fire_at`, on Graphile cron or our own scheduler loop (decide in the slice).
  - Missed-run policy (`catch_up_once` default, `skip`, `run_all` capped at 10) on boot, on resume-from-sleep (power event plus a clock-jump check) and on a quit/relaunch.
- [ ] **D5.3 Natural-language schedules.** The helper model parses to a trigger and always shows it back for confirmation.
- [ ] **D5.4 Receipts.** A check script on the computer, a helper-model rubric, or "a delivered message exists". A failed receipt marks the run "needs attention".
- [ ] **D5.5 Routines UI + delivery.** (head-coder: UI) List, editor, run history, the delivery channel, Windows notifications.
- [ ] **D5.6 Heartbeat.** A per-profile special routine over the `heartbeat` block. It stays silent unless there is something to do (`NOTHING` or an action).
- [ ] **D5.7 Schedule tools.** `schedule_create/list/cancel` for the agent (policy: `ask` by default).

## D6 — Trace compiler
Goal: a repeated routine runs as a fast, cheap, deterministic script. See REDESIGN §8.

- [ ] **D6.1 Recording spike.** Verify that Playwright MCP reports the locator code for each action, and capture shell steps and judgment steps from the run's tool calls.
- [ ] **D6.2 Compiler.** A run that passed its receipt becomes a versioned `traces` script with typed holes (model calls with narrow prompts, called only when needed, e.g. a non-empty diff).
- [ ] **D6.3 Trace runner.** Run the script on the computer, the receipt still checks; cost and time shown against the model run.
- [ ] **D6.4 Self-heal.** One failing step → the model proposes a replacement for that step only → continue → save a new version with a diff and an audit entry. After N failed heals, fall back to a full model run and notify.
- [ ] **D6.5 Trace UI.** (head-coder: UI) Script view, versions and diffs, holes, "re-learn".

## D7 — Telegram & Discord

- [ ] **D7.1 Channel adapter core.** Normalised inbound and outbound, thread mapping, owner pairing code, allowlist, token locks. Long polling only (no inbound networking).
- [ ] **D7.2 Telegram (grammY).** Chat, inline approval buttons, commands, takeover deep link.
- [ ] **D7.3 Discord (discord.js).** DM + mention, buttons, slash commands.

## D8 — Remote access + mobile

- [ ] **D8.1 Device auth + pairing.** Ed25519 device keys, a one-time pairing code, a QR payload, and device list/revoke in Settings. It builds on the D1.4 token: every `/rpc` procedure except `health.get` and `devices.pair` requires a session. (Propose head-reviewer.)
- [ ] **D8.2 Tailscale.** Detect Tailscale, guide `tailscale serve` for the local server, and add its URL to the pairing QR. An own E2E relay is a stretch (S6).
- [ ] **D8.3 Expo app shell.** expo-router tabs, tokens through `ui-native`, theme and accent synced with the server settings, and Reanimated presets.
- [ ] **D8.4 Mobile chat + activity + approvals.** Push notifications through Expo (opt-out).
- [ ] **D8.5 Mobile computer view.** noVNC in a WebView, touch → mouse, keyboard bar, takeover.

## D9 — Polish & ship

- [ ] **D9.1 Mascot.** Rive state machine (8 states) on web, the desktop tray and mobile.
- [ ] **D9.2 Accessibility + reduced-motion audit**, visual-regression baseline, and performance budgets.
- [ ] **D9.3 Local plugin import.** (S4) A folder or zip with skills, MCP configs, prompt blocks and routine templates, reviewed before install.
- [ ] **D9.4 Docs site / README quick start**, and the release workflow (installer to GitHub Releases, headless image to GHCR, EAS builds).
  - Eligibility check from P1.3b: a paid or remotely hosted distribution needs OpenAI's SIWC interest form, and the Claude plan provider must go if Mawl is ever distributed or multi-user.
- [ ] **D9.5 72 h soak test** with routines, heartbeat, sleep and wake, and two teammates sharing a computer.

## Later (Should/Could from SPEC)
S1 teammate delegation · S2 Sentinel · S3 teach-by-demo · S5 voice · S6 E2E relay · S7 cost dashboard · Mawl marketplace · WebRTC streaming · remote sandbox providers · macOS and Linux builds.

Open note from P1.3b and P1.5: `@mawl/server#test` failed once under the full parallel gate (PGlite suites near `hookTimeout`), and the web suites (shell, command palette, chat hooks) and `@mawl/core` `claude-code/workdir.test.ts` ("different per process", two fresh module imports) time out under heavy machine load; all pass alone (2026-10-21). Find the cause when more PGlite suites are added.

---

## Slice template (copy into the orchestrator's task brief)

```
Slice: P?.? <name>
Agent: coder | head-coder (why, if head-coder)
Goal: <one sentence user/dev-visible outcome>
Context: <docs sections + files explorer found>
Tests first: <list of failing tests to write — unit / integration / e2e>
Done when: <acceptance criteria> + lint/typecheck/test green + reviewer has no blocking findings
Out of scope: <explicit>
```
