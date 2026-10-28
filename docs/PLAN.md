# Mawl — Implementation Plan

This is the working roadmap the orchestrator follows. Each **slice** is a vertical, testable unit, sized for one round of the orchestration loop (see CLAUDE.md). Mark a slice `[x]` only after the runner, test-author and reviewer all pass (and the head-reviewer, when the user approved one). Add the short commit range next to it.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (write why)


## Phases (one file each; read only the phase you are working on)

| Phase | done | wip | todo | blocked |
|---|---|---|---|---|
| [L1 — Public landing page](docs/plan/l1.md) | 1 | 1 | 0 | 0 |
| [D0 — Spikes (de-risk the redesign)](docs/plan/d0.md) | 2 | 0 | 0 | 0 |
| [P0 — Foundation](docs/plan/p0.md) | 5 | 0 | 0 | 0 |
| [P1 — Talk to a teammate (web + desktop)](docs/plan/p1.md) | 9 | 0 | 0 | 1 |
| [U — Mawl UI redesign (see [UI-REDESIGN.md](UI-REDESIGN.md))](docs/plan/u.md) | 7 | 0 | 0 | 0 |
| [D1 — Desktop host (install and go)](docs/plan/d1.md) | 13 | 1 | 6 | 1 |
| [D2 — The agent loop](docs/plan/d2.md) | 2 | 0 | 16 | 0 |
| [D3 — Nodes: This PC first, then Docker computers](docs/plan/d3.md) | 0 | 0 | 12 | 0 |
| [DP — Projects (added 2026-10-24, REDESIGN R18)](docs/plan/dp.md) | 0 | 0 | 6 | 0 |
| [D4 — Memory system (see MEMORY.md)](docs/plan/d4.md) | 0 | 0 | 8 | 0 |
| [D5 — Schedules and always-on](docs/plan/d5.md) | 0 | 0 | 9 | 0 |
| [DC — Canvas (see [CANVAS.md](CANVAS.md))](docs/plan/dc.md) | 0 | 0 | 17 | 0 |
| [D6 — Trace compiler](docs/plan/d6.md) | 0 | 0 | 6 | 0 |
| [D7 — Telegram & Discord](docs/plan/d7.md) | 0 | 0 | 3 | 0 |
| [D8 — Remote access + mobile](docs/plan/d8.md) | 0 | 0 | 8 | 0 |
| [D10 — Mawl Cloud (parked 2026-10-24, REDESIGN R21)](docs/plan/d10.md) | 0 | 0 | 0 | 0 |
| [D9 — Polish & ship](docs/plan/d9.md) | 0 | 0 | 5 | 0 |
| [Later (Should/Could from SPEC)](docs/plan/later.md) | 0 | 0 | 0 | 0 |

Counts are lines containing each marker; update the row when a slice changes state. When you mark a slice, edit its phase file, not this index.

## Versions (mochi names, owner convention 2026-10-24)

Each version is named after a mochi and ships the slices listed, in that order; the slices themselves live in their phases below. A version is done when all its slices are `[x]`. The app version in `tauri.conf.json` (now `0.0.0`) becomes `0.1.0` when 0.1 ships, and a GitHub Release is titled "Mawl 0.1 Shiro". Rough early versions are 0.1 to 0.3; features are built into the dough from 0.4 to 0.6; the app is filled from 0.7 to 0.9.

**We are on 0.1 Shiro (in progress).**

| Version | Theme | What it adds | Slices |
|---|---|---|---|
| **0.1 Shiro** (in progress) | Plain white mochi, just the core | Install from one Windows installer, Mawl in the tray, embedded Postgres, local auth, providers (ChatGPT sign-in, API keys, Ollama, Claude plan for the owner), first-run onboarding, chat with a teammate | Done: D0, P0, P1, U1–U7, D1.1–D1.7b (D1.5b2c and D1.5b2d move to 0.6), D1.7e, D2.1. Open: **D1.7c, D1.8** |
| **0.2 Kinako** | Dusted, the simplest finish | Teammates can act: the tool registry and built-ins (web fetch and search, ask, notify), the policy engine, approvals, steering mid-run | D2.2, D2.3, D2.4, D2.5 |
| **0.3 Goma** | Sesame, a bit more depth | Work on this PC with no Docker (folder grants, files, shell with approval), Connections that just work: mail first, then calendar, files, notes, chat, tasks and design, from a featured shelf or the MCP Registry in one click, or asked for by a teammate mid-chat; skills | D3.2, D3.H1, D3.H2, D3.H3, D2.9a, D2.9b, D2.9c, D2.8 |
| **0.4 Hojicha** | Roasted tea, warm and mellow | Projects (brief, voice, references, linked folders), teammates that ask each other for help, the teammates UI | DP1, DP2, DP3, DP4, D2.7, D2.14, D2.11 |
| **0.5 Matcha** = **Beta 1** (late December 2026 to January 2027) | The classic flavor | Always on: core memory blocks, schedules in plain language, the routines UI, and the updater so testers get the next versions | D4.1, D5.2, D5.3, D5.5, D1.7d |
| **0.6 Yuzu** | Bright citrus, "this is getting sharp" | Reliable and visible: fallback models, the activity feed, receipts, background-run controls, heartbeat, schedule tools, approval notifications from the server, the reconnecting banner, the loop eval set, the Claude plan bridge (owner's build only) | D2.6, D2.12, D5.4, D5.1, D5.6, D5.7, D1.5b2c, D1.5b2d, D2.13, D2.10 |
| **0.7 Anko** = **Beta 2** | The first one with something inside | Canvas: mockups, sites and graphics beside the chat, the Canvases view, export; the project brand kit | DC0.1, DC0.2, DC1–DC8, DP5 |
| **0.8 Sakura** | Refined, with a bean filling | Docker computers you can watch and take over, and the full memory system (recall, facts, compaction, the Memory UI, project memory) | D3.1, D3.3–D3.9, D4.2–D4.8, DP6 |
| **0.9 Ichigo** | Nearly the finished product | Anywhere: Telegram and Discord, the personal relay, the phone app with its own tools (reminders, calendar), webhooks and workflows | D7.1–D7.3, D8.1, D8.2, D8.2b, D8.3–D8.7, D5.8, D5.9 |
| **1.0 Daifuku** | Everything is inside | Learns and ships: the trace compiler, teach by demonstration, canvas evals, the mascot, the a11y audit, local plugin import, docs, release and the 72 h soak test | D6.1–D6.6, DC12, D9.1–D9.5 |
| **1.x** (Mitarashi, Warabi, Zenzai, Kuzumochi, …) | Sweeter, more elaborate | Motion canvases and video (Remotion), hand editing, canvases from routines, MCP Apps in the canvas sandbox, group chats, Sentinel, voice, cost dashboard, model routing, other PCs as nodes, macOS and Linux | DC0.3, DC9–DC11, DC13, DC15, and the Later list |

- *Gate before any tester installs Beta 1:* a shared build does not offer the Claude plan provider, and SIWC eligibility is re-checked (REDESIGN §12.3).
- If a version runs long, its last slices move to the next version; the order inside a version stays.

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
