# Faire — Implementation Plan

This is the working roadmap the orchestrator follows. Each **slice** is a vertical, testable unit, sized for one round of the orchestration loop (see CLAUDE.md). Mark a slice `[x]` only after the tester and reviewer both pass. Add the short commit range next to it.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (write why)

---

## P0 — Foundation
Goal: an empty but real monorepo with CI, tokens and test infrastructure. Nothing user-facing yet.

- [~] **P0.1 Scaffold monorepo.** Set up the workspace and tooling.
  - pnpm workspace (pnpm 10.18.0 via corepack), Turborepo, TS strict base config, Biome, Vitest `test.projects`, `.editorconfig`, `.nvmrc` (Node 24 LTS).
  - Empty packages per ARCHITECTURE §2, each with a passing smoke test.
  - *Accept:* `pnpm i && pnpm turbo lint typecheck test` is green.
- [ ] **P0.2 CI.** GitHub Actions running lint, typecheck, test, and build with the Turbo cache. A Postgres service is used for integration tests.
- [ ] **P0.3 Design tokens.** In `packages/ui`, turn the DESIGN.md tokens into CSS variables plus a TS export.
  - Includes the accent engine: input hex → OKLCH scale → `--accent-*`.
  - *Tests:* contrast ratios ≥ 4.5 for text-on-accent across all presets in light and dark.
- [ ] **P0.4 testkit.** A scripted fake `LanguageModelV2` (deterministic text, tool calls, streaming), fixture builders, and a Testcontainers Postgres helper.
- [ ] **P0.5 Contracts.** zod schemas for the core entities and the event union, plus an oRPC router skeleton.

## P1 — Talk to a teammate (web + desktop)
Goal: chat in a real UI with one profile, streaming from a real or fake model.

- [ ] **P1.1 DB schema v1.** Drizzle migrations for `profiles`, `provider_credentials`, `threads`, `messages`, `runs`, `run_steps`, `artifacts`, `events`. Add pgvector/FTS extensions.
- [ ] **P1.2 Server skeleton.**
  - Hono + oRPC + health endpoint + pino.
  - Secret key bootstrapped on first boot, with libsodium encrypt/decrypt.
- [ ] **P1.3 Provider registry.**
  - Anthropic, OpenAI, OpenRouter, Ollama, and OpenAI-compatible providers, with capability flags.
  - `providers.test()` validates a key.
- [ ] **P1.4 Run engine v1.**
  - AI SDK v6 loop with durable steps, the run state machine (queued → running → succeeded/failed/cancelled), and budget caps.
  - Graphile Worker job.
  - *Tests:* fake model; crash/resume from the persisted step.
- [ ] **P1.5 Event bus + WS hub.**
  - Postgres `NOTIFY` → WS fan-out with `since` resume.
  - `packages/client` store with TanStack Query integration.
- [ ] **P1.6 Web app shell.**
  - Three-pane layout, theme (light/dark/system), and accent switcher wired to tokens.
  - Command palette and Motion presets.
- [ ] **P1.7 Chat UI.**
  - Streaming message list, composer (attachments later), and tool-activity cards (collapsed summaries).
  - Mascot state hook (SVG fallback) and empty states.
  - *e2e:* send a message → streamed reply (fake provider).
- [ ] **P1.8 Desktop shell.** Tauri 2 wraps the web build: server URL setting, tray, notifications, single-instance, deep-link `faire://`.
- [ ] **P1.9 Compose v1.** `server` + `db`. `docker compose up` gives a working chat at :7420 (the server serves the web build).

## P2 — Profiles, tools, MCP, approvals

- [ ] **P2.1 Profiles CRUD.** Persona editor, color/avatar, main and helper model, clone and archive. Teammate list UI.
- [ ] **P2.2 Tool registry + built-ins.** `web_fetch`, `web_search` (pluggable), `ask_user`, `notify`, `read_artifact`. Artifacts for outputs over 4k tokens.
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
- [ ] **P5.2 Routines.**
  - Cron or RRULE storage, a natural-language → schedule parser (helper model + confirmation), and Graphile cron.
  - Routines UI with run history and a delivery channel.
- [ ] **P5.3 Heartbeat.** A per-profile interval that reviews the `heartbeat` block. It stays silent unless there is something to do (the model must output either `NOTHING` or an action).
- [ ] **P5.4 Schedule tools.** The agent can create, list and cancel its own routines (policy: `ask` by default).

## P6 — Mobile

- [ ] **P6.1 Device auth + pairing.** Ed25519 device keys, a one-time pairing code, a QR payload, and device list/revoke in Settings.
- [ ] **P6.2 Expo app shell.** expo-router tabs, tokens through `ui-native`, theme and accent synced with the server settings, and Reanimated presets.
- [ ] **P6.3 Mobile chat + activity + approvals.** Push notifications through Expo (opt-out).
- [ ] **P6.4 Mobile computer view.** noVNC in a WebView, touch → mouse, keyboard bar, takeover.

## P7 — Telegram & Discord

- [ ] **P7.1 Channel adapter core.** Normalised inbound/outbound, thread mapping, owner pairing code, allowlist, token locks.
- [ ] **P7.2 Telegram (grammY).** Chat, inline approval buttons, commands, takeover deep link.
- [ ] **P7.3 Discord (discord.js).** DM + mention, buttons, slash commands.

## P8 — Polish & ship

- [ ] **P8.1 Onboarding.** Three steps with the beaver, provider key or Ollama detection, first teammate, phone pairing.
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
