# Faire — Implementation Plan

This is the working roadmap the orchestrator follows. Each **slice** is a vertical, testable unit, sized for one round of the orchestration loop (see CLAUDE.md). Mark a slice `[x]` only after the tester and reviewer both pass. Add the short commit range next to it.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (write why)

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
- [x] **P1.2 Server skeleton.** (bad1d4b..5aec5bb; all suites green with `FAIRE_REQUIRE_DOCKER=1`)
  - Decided: keep the base `bundler` tsconfig. Dev runs `tsx watch`, and prod is an esbuild bundle (`dist/server.mjs` + `dist/drizzle`). Native Node type stripping is out because workspace packages use extensionless relative imports.
  - Hono + oRPC + health endpoint + pino.
  - Secret key bootstrapped on first boot, with libsodium encrypt/decrypt.
- [x] **P1.3 Provider registry.** (8da5da9..2db16a4; all suites green with `FAIRE_REQUIRE_DOCKER=1`) Add the contract procedures `providers.list/create/delete/test`, with the secret only in a strictObject input (review note from P0.5).
  - Anthropic, OpenAI, OpenRouter, Ollama, and OpenAI-compatible providers, with capability flags.
  - `providers.test()` validates a key.
- [x] **P1.3b Sign in with ChatGPT (the preferred way to use Faire).** (ef3c6c4..535f1a9; all suites green with `FAIRE_REQUIRE_DOCKER=1`; security properties mutation-checked) The owner signs in with a ChatGPT Plus/Pro account, and runs use that plan's limits instead of an API key. API keys stay as the alternative.
  - Uses OpenAI's "Sign in with ChatGPT" plan-usage flow for open-source and locally run apps (developers.openai.com/siwc/token-sharing-open-source): OIDC + PKCE, `client_id=dynamic_agent_client` (OpenAI issues the client id during the first sign-in; persist it before the code exchange), a loopback callback on `127.0.0.1`, and Responses API scopes.
  - New `ProviderKind` `openai_chatgpt`. Its credential row stores the issued client id, OAuth tokens and account info, encrypted like API keys. A persisted opaque host id (`urn:uuid:`, never user-identifying) is shared by every credential on this server.
  - Inference goes to `https://api.openai.com/v1` Responses with the OAuth access token, `store: false`, `stream: true`. Refresh tokens before expiry, handle revocation and logout, and map plan-limit errors to a clear "plan limit reached" run failure.
  - Where the browser runs: v1 handles the callback on the server host (the browser is on the same machine). The desktop app (P1.8) runs the loopback flow itself and transfers the credentials to the server over an authenticated call, as the SIWC self-hosted guidance describes.
  - Follow OpenAI's SIWC UI/UX guidelines for the sign-in button, plan usage and plan selection. Onboarding (P8.1) offers "Sign in with ChatGPT" first.
  - Eligibility: OpenAI allows plan usage for open-source projects and personal projects that run locally. A paid or remotely hosted distribution of Faire needs OpenAI's interest form first; check before P8.5.
  - Verify every endpoint, scope and error code from OpenAI's current docs at slice start. This bullet list is a research summary, not a verified API.
  - Verified 2026-10-18 (developers.openai.com/siwc/token-sharing-open-source): authorize `https://auth.openai.com/api/accounts/authorize`, token `https://auth.openai.com/api/accounts/oauth/token`, discovery `https://auth.openai.com/.well-known/openid-configuration` (revocation endpoint). Scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, resource `https://api.openai.com/v1`, PKCE S256, redirect `http://127.0.0.1:<port>/auth/callback` (never `localhost`). `ext_agent_host_id` as `urn:uuid:` v4. Access tokens live 3600 s; refresh tokens rotate and live 30 days. Errors `subscription_sharing_*` (`usage_limit_exceeded` 429 → plan limit reached). Unsupported Responses fields (`temperature`, `max_output_tokens`, `top_p`, ...) are stripped. No official SDK; the `@ai-sdk/openai` Responses model is used with a token-injecting fetch.
  - **Claude account (owner decision 2026-10-18: Faire is a personal, self-hosted project, not distributed).** New `ProviderKind` `anthropic_claude_code`: runs the unmodified Claude Code binary through `@anthropic-ai/claude-agent-sdk`, and the owner signs in with Claude Code's own flow (`claude auth login` on the server host or container). Faire never collects, stores or reads Claude.ai credentials, which is the only subscription path Anthropic's terms allow (code.claude.com/docs/en/legal-and-compliance: "sign-in to a Claude account must complete through Anthropic's own flow"). Built-in tools disabled, no setting sources, clean env (no `ANTHROPIC_*`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_*`). If Faire is ever distributed or multi-user, this provider must go (check before P8.5).
- [x] **P1.4 Run engine v1.** (1abc23c..e9bc662; gate green with `FAIRE_REQUIRE_DOCKER=1`; CAS, atomic steps, crash resume and budgets mutation-checked)
  - Decided: `profiles.model_main` is `<credentialId>:<modelId>` (split at the first `:`); `runs.error` holds a closed `RunErrorCode`; the wall-clock budget counts active time (`runs.active_ms`, migration 0005); Graphile Worker 0.18.0 runs task `run.execute` with boot recovery. Cost cap and `contextWindow` are not built yet (S7, P3.5).
  - AI SDK v7 loop with durable steps, the run state machine (queued → running → succeeded/failed/cancelled), and budget caps.
  - Graphile Worker job.
  - *Tests:* fake model; crash/resume from the persisted step.
  - Review note from P1.1: drizzle writes JS `null` as SQL NULL, so NOT NULL jsonb columns (`run_steps.input_json`, `events.payload_json`) need `jsonValue()` from `@faire/db`. Put `run_steps`/`events` inserts and updates behind one repository helper that always applies it, and test that a raw `null` is stored as JSON null.
  - Thread deletion is blocked while runs reference the thread (FK, no action). Decide archive vs delete when a thread-delete path appears.
  - Review notes from P1.3b:
    - The `openai_chatgpt` model refuses non-stream calls, so the loop uses `streamText`, never `generateText`.
    - `anthropic_claude_code` is text-only. Bridge Faire tools to it through an in-process MCP server (the SDK's `createSdkMcpServer`), still through the policy engine.
    - A Claude `rate_limit_event` with status `rejected` is a hard failure today, even when overage may be allowed. Revisit when overage info is reliable.
    - `ProviderFailureReason` (contracts) from `ProviderFailureError` (core) feeds the run failure reason and the app's explanation.
    - `@faire/server#test` failed once under the full parallel gate even after `hookTimeout` went to 60 s (PGlite suites), and passed on rerun. Find the cause when the run engine adds more PGlite suites.
- [x] **P1.5 Event bus + WS hub.** (7477944..191fe02)
  - Postgres `NOTIFY` → WS fan-out with `since` resume.
  - `packages/client` store with TanStack Query integration.
  - Review notes from P1.5:
    - The `/ws` hub and HTTP `/rpc` are separate router instances; HTTP `events.subscribe` returns 501. Fine while all clients use `/ws`.
    - Shutdown order is tested through `createLiveEvents().stop()`, not a full `startServer` boot.
    - The one-off `@faire/server#test` failure (2 files plus an unhandled error) did not reproduce in 8 runs. Same suspect as the P1.3b note: PGlite suites near `hookTimeout` under the parallel gate.
- [x] **P1.6 Web app shell.** (1f4d411..3213cee, merged in f872072)
  - tsconfig override for UI apps: `DOM` + `DOM.Iterable` libs, `jsx: react-jsx`, no `node` types. Relax `exactOptionalPropertyTypes` only where a library forces it (review note from P0.1).
  - Three-pane layout, theme (light/dark/system), and accent switcher wired to tokens.
  - Command palette and Motion presets.
  - Review note from P1.3b: provider settings follow OpenAI's SIWC UI guidelines: a "Continue with ChatGPT" button, a "Using ChatGPT plan" tag, "Manage usage" linking to https://chatgpt.com/settings/usage, and a "Usage limit reached" state. Show `reauthRequired` as a sign-in-again prompt. When `providers.delete` returns `revoked: false`, tell the owner to revoke access in ChatGPT settings. Same rules apply in onboarding (P8.1).
- [x] **P1.7 Chat UI.** (11e3832..d9ed15b; tester mutation-checked 18 behaviours, e2e 5/5; full parallel gate flaked on machine load, suites green alone)
  - Decided at slice start: chat needs a teammate, so the server implements `profiles.list/get/create/update/archive` now (plain CRUD, typed `SLUG_TAKEN` and `UNKNOWN_CREDENTIAL` errors) and the app gets a minimal "New teammate" dialog (name + model). The persona editor, color and avatar, clone and the teammate management UI stay in P2.1.
  - e2e: Playwright drives the Vite app against a dev-only server entry (`apps/server/src/e2e/serve.ts`, refuses to start without `FAIRE_E2E=1`, never bundled) that boots its own Postgres container and answers every run with a scripted fake model. Locally Playwright uses the installed Edge (`channel: 'msedge'`); CI installs Chromium.
  - Streaming message list, composer (attachments later), and tool-activity cards (collapsed summaries).
  - Mascot state hook (SVG fallback) and empty states.
  - *e2e:* send a message → streamed reply (fake provider).
  - Note from P1.6: the web main chunk is 691 kB (225 kB gzip) after Settings was split off. Split the chat view and heavy vendors (Motion, cmdk) here if it grows.
  - Review note from P1.6: `createApi` (apps/web `src/api/create-api.ts`) drops the `createFaireClient` handle. Expose it through `Api` (or one module-level client) so the event store shares the same socket, start `createEventStore` with the app's `QueryClient`, and stop it on unmount.
- [~] **P1.8 Desktop shell.** Paused mid-slice 2026-10-18: Tauri scaffold in apps/desktop (uncommitted or partly committed; check `git log` and `git status`), deep-link parser tests started. Decided: Sign in with ChatGPT desktop handoff moves to P6.1 (needs the authenticated device call). The UI half (server URL setting, notifications, deep-link navigation, external links) is not started. Tauri 2 wraps the web build: server URL setting, tray, notifications, single-instance, deep-link `faire://`.
  - Review note from P1.3b: the desktop app owns the SIWC loopback flow and transfers the credentials to the server over an authenticated call. The VM or host keeps its own `ext_agent_host_id`.
- [x] **P1.9 Compose v1.** (895f4e3..adf5a49, merged in 0068726; stack verified booting at :7420. Note: the compose smoke test builds the image inside the default gate, about 1 min; move it to its own task if CI time bites) `server` + `db`. `docker compose up` gives a working chat at :7420 (the server serves the web build).
  - Review notes from P1.3b:
    - Publish `127.0.0.1:1455:1455` and set `FAIRE_SIWC_BIND_HOST=0.0.0.0` inside the container, so the SIWC callback reaches the server.
    - Install `@anthropic-ai/claude-agent-sdk` as a production dependency for the image's libc (the native binary is about 290 MB). Keep it external to the esbuild bundle, and add a `claude` symlink so `docker compose exec server claude auth login` works.
    - Put `FAIRE_CLAUDE_CONFIG_DIR` (`CLAUDE_CONFIG_DIR` for the binary) on a named volume.
    - Verify that headless `claude auth login` works in the container.

## P2 — Profiles, tools, MCP, approvals

- [ ] **P2.1 Profiles CRUD.** Persona editor, color/avatar, main and helper model, clone and archive. Teammate list UI.
- [ ] **P2.2 Tool registry + built-ins.** `web_fetch`, `web_search` (pluggable), `ask_user`, `notify`, `read_artifact`. Artifacts for outputs over 4k tokens.
  - Review notes from P1.4: `executeRun` passes `deps.tools` straight to `streamText`; route every call through the policy engine (P2.3) first. A crash between a tool's side effect and the step write re-runs the tool on resume, so tools need idempotency keys (`run_id`, `step_idx`, `toolCallId`). Wrap tool results as untrusted data. Bridge tools to `anthropic_claude_code` through an in-process MCP server (`createSdkMcpServer`).
- [ ] **P2.3 Policy engine.**
  - Action classes, levels, rule precedence, and the non-lowerable classes.
  - *Tests:* a table-driven rule-matrix test.
- [ ] **P2.4 Approvals flow.**
  - `waiting_approval` releases the worker. Approvals inbox UI, inline approval card in chat, and resolution events.
  - A denial is returned to the model.
- [ ] **P2.5 MCP manager.** HTTP/SSE servers with OAuth (`@ai-sdk/mcp`), a per-profile enable list, per-tool policy, a Connections UI, and a curated catalog JSON.
- [ ] **P2.6 Activity feed + audit log UI.** Filterable by profile, type and time.

## P3 — Memory system (see MEMORY.md)

- [ ] **P3.1 Memory schema + core blocks.**
  - Blocks with caps and versions, `memory_block_edit` tool, frozen-per-segment rendering.
  - *Tests:* cap rejection; byte-stable prefix across edits.
- [ ] **P3.2 Episodic log + `session_search`.** Episodes with FTS and artifact references.
- [ ] **P3.3 Embedder + hybrid recall.**
  - Pluggable embedder, HNSW, RRF + rescoring + MMR, automatic injection.
  - *Tests:* the ranking math, plus a fixture corpus with expected top-k.
- [ ] **P3.4 Fact extraction (warm path).** Extract → compare → ADD/UPDATE/INVALIDATE/NOOP, bi-temporal, injection scanner, `memory_ops` audit. Includes the golden set.
- [ ] **P3.5 Compaction ladder.**
  - Review notes from P1.4: resolve `contextWindow` per model id here. Two runs on the same thread can execute at once and both read the same history; decide whether a thread runs one run at a time.
  - L0–L3 with thresholds, pre-flush, checkpoints, segment rollover, and native Anthropic context editing when available.
  - *Tests:* survival ≥ 95%.
- [ ] **P3.6 Sleep-time consolidator.** Dedupe, re-densify, digests, decay, and a "what changed overnight" record.
- [ ] **P3.7 Memory UI.** Blocks, facts table, timeline, skills, history and undo, "used memories" on messages.
- [ ] **P3.8 Long-horizon eval harness.** A simulated 3-day workload and a metrics report (runs nightly in CI with the fake model, manually with a real one).

## P4 — The computer (sandbox + live view + takeover)

- [ ] **P4.1 Computer image.**
  - `infra/sandbox/Dockerfile`: Xvfb, XFCE, Chromium, x11vnc, websockify, Playwright MCP headed, and the `computer-agent` helper, under supervisord.
  - Image smoke test in CI.
- [ ] **P4.2 DockerProvider.** `ensure` / `suspend` / `exec` / `status` via the socket-proxy, the internal network, the home volume, and idle auto-suspend.
- [ ] **P4.3 Computer tools.** `shell`, file tools, `computer_screenshot`, `computer_act` (batched), browser via Playwright MCP over stdio-in-sandbox.
- [ ] **P4.4 Screen gateway.** Ticketed WS proxy (view/control capabilities, tickets in the subprotocol header), input dropping for viewers.
- [ ] **P4.5 Computer panel UI.**
  - noVNC RFB component, Watch / Take control / Give back, lease timer.
  - The agent's "cursor ghost" overlay showing its current action.
- [ ] **P4.6 Takeover protocol + `request_takeover`.** The `waiting_takeover` state, notifications, the resume note to the agent.
- [ ] **P4.7 Credential form.** Secure type-into-sandbox, with redacted audit.

## P5 — Always on: background, routines, heartbeat

- [ ] **P5.1 Background runs UX.** Pause, resume and cancel from anywhere, plus "Pause all teammates".
  - Review notes from P1.4: add a stale-run sweeper. A run stays `running` with no job after Graphile exhausts its 5 attempts on infra errors, after an enqueue failure right after `runs.start`, or after 30 resume requeues; today only boot recovery picks it up. A deterministic non-provider error from `createModel` retries 5 times before that; fail it as `internal_error` on the last attempt.
- [ ] **P5.2 Routines.**
  - Cron or RRULE storage, a natural-language → schedule parser (helper model + confirmation), and Graphile cron.
  - Routines UI with run history and a delivery channel.
- [ ] **P5.3 Heartbeat.** A per-profile interval that reviews the `heartbeat` block. It stays silent unless there is something to do (the model must output either `NOTHING` or an action).
- [ ] **P5.4 Schedule tools.** The agent can create, list and cancel its own routines (policy: `ask` by default).

## P6 — Mobile

- [ ] **P6.1 Device auth + pairing.** Ed25519 device keys, a one-time pairing code, a QR payload, and device list/revoke in Settings.
  - Review notes from P1.2/P1.3: every `/rpc` procedure except `health.get` and `devices.pair` requires a device session (`providers.*` holds the owner's keys). Add a request body size limit on `/rpc`. Until then the server binds to `127.0.0.1` by default.
  - `providers.test` with an inline input sends a key to any URL the caller picks (an SSRF oracle). With auth in place, also: block link-local/metadata ranges (169.254.0.0/16, fd00:ec2::/32), resolve DNS once and pin the IP (anti-rebinding), allow private ranges only through an explicit owner opt-in (Ollama on the LAN), and rate-limit `test`.
  - Review notes from P1.5: `/ws` has no auth yet. The Host allowlist stops DNS rebinding, but any page served from loopback (any port) passes the origin check. Require a device session on the `/ws` upgrade, and scope `events.subscribe` topics to the device's owner.
- [ ] **P6.2 Expo app shell.** expo-router tabs, tokens through `ui-native`, theme and accent synced with the server settings, and Reanimated presets.
- [ ] **P6.3 Mobile chat + activity + approvals.** Push notifications through Expo (opt-out).
- [ ] **P6.4 Mobile computer view.** noVNC in a WebView, touch → mouse, keyboard bar, takeover.

## P7 — Telegram & Discord

- [ ] **P7.1 Channel adapter core.** Normalised inbound/outbound, thread mapping, owner pairing code, allowlist, token locks.
- [ ] **P7.2 Telegram (grammY).** Chat, inline approval buttons, commands, takeover deep link.
- [ ] **P7.3 Discord (discord.js).** DM + mention, buttons, slash commands.

## P8 — Polish & ship

- [ ] **P8.1 Onboarding.** Three steps with the beaver, provider key or Ollama detection, first teammate, phone pairing.
  - Review note from P1.3b: offer "Continue with ChatGPT" first, following the SIWC UI rules recorded in P1.6.
- [ ] **P8.2 Installer.** `install.sh` / `install.ps1`, generated secrets, and the desktop "Start my stack" button.
- [ ] **P8.3 Mascot.** Rive state machine (8 states) on web, desktop tray and mobile.
- [ ] **P8.4 Accessibility + reduced-motion audit**, visual-regression baseline, and performance budgets.
- [ ] **P8.5 Docs site / README quick start**, release workflow (images to GHCR, Tauri bundles, EAS builds).
- [ ] **P8.6 72 h soak test** with routines and heartbeat across two profiles.

## Later (Should/Could from SPEC)
S1 teammate delegation · S2 Sentinel · S3 teach-by-demo · S4 skill import + learned skills · S5 voice · S6 E2E relay · S7 cost dashboard · WebRTC streaming · remote sandbox providers.

---

## Slice template (copy into the orchestrator's task brief)

```
Slice: P?.? <name>
Goal: <one sentence user/dev-visible outcome>
Context: <docs sections + files explorer found>
Tests first: <list of failing tests to write — unit / integration / e2e>
Done when: <acceptance criteria> + lint/typecheck/test green + reviewer has no blocking findings
Out of scope: <explicit>
```
