# Mawl — guide for Claude

Mawl is a self-hosted, always-on agent app ("AI teammates you own"). It has:
- a Tauri 2 desktop app that hosts the server and an embedded Postgres (desktop-first, Windows first; see docs/REDESIGN.md), plus a headless/Docker mode
- optional Docker computers for teammates (terminal or desktop kind)
- later: Telegram/Discord channels and an Expo mobile app
- a long-horizon memory system

**Read before any work:**
- [docs/SPEC.md](docs/SPEC.md): what and why
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how
- [docs/MEMORY.md](docs/MEMORY.md): memory and context
- [docs/PLAN.md](docs/PLAN.md): what's next, with status
- [docs/REDESIGN.md](docs/REDESIGN.md): the 2026-10 desktop-first decision record (wins over older docs where they disagree)
- [docs/DESIGN.md](docs/DESIGN.md): look and feel
- [docs/CANVAS.md](docs/CANVAS.md): the planned canvas feature (read before any DC slice or any sandboxed-iframe work)

## Voice: caveman skill, always on (default mode)

Every agent (orchestrator and all subagents in `.claude/agents/`) uses the **`caveman`** skill (`.claude/skills/caveman/SKILL.md`) in its default mode for chat, status lines and subagent reports.
- Default mode only: not `ultracave` or `megacave` unless the user asks.
- Per the skill, these stay normal, full prose:
  - anything persisted (code, comments, commit messages, docs, PLAN updates, UI copy)
  - security warnings and irreversible-action confirmations
  - questions to the user
- Code, commands, paths, versions and error strings stay verbatim.
- The user can say "stop caveman" or "normal mode" to switch it off.

## Roles

**You (the main session, Sonnet): orchestrator and planner.**
- You own PLAN.md, slice the work, write the briefs, dispatch subagents, judge their results and keep the docs true.
- Do small glue edits yourself (doc fixes, one-line config), and delegate real implementation, including all UI.

| Agent | Model | Writes | Use it for |
|---|---|---|---|
| `explorer` | Haiku | nothing | Read-only context: doc sections, existing code, current library versions and APIs |
| `coder` | Sonnet | code + tests | **Light and general slices:** single-package features, fixes, wiring, config, scripts, docs-heavy work |
| `head-coder` | Opus | code + tests | **Hard slices** (list below), **all frontend/UI slices**, and any slice the coder failed twice |
| `runner` | Haiku | nothing | Runs the full gate (Docker suites required) and e2e, plus browser visual checks. Reports only |
| `test-author` | Sonnet | test files only | Hunts edge cases, writes them as tests, mutation-checks the slice's tests |
| `reviewer` | Sonnet | nothing | Every slice: read-only review of the commit range, findings ranked by severity |
| `head-reviewer` | Opus | nothing | **Ask the user first, every time.** High-stakes changes (list below) |
| `advisor` | Opus | nothing | **Ask the user first, every time.** A hard design, slicing or debugging decision you can't settle yourself |

**A slice is hard (→ `head-coder`) when it touches any of:**
- more than one package's public API, `@mawl/contracts`, or the event envelope
- the run engine, `RUN_TRANSITIONS`, concurrency, jobs, retries or resume
- the memory system (docs/MEMORY.md)
- DB migrations
- policy, approvals, credentials, secrets or the sandbox boundary
- a design the brief can't pin down in advance
When unsure, it's not hard: start with `coder`. The escalation rule catches the rest.

**Escalation (automatic).** After 2 fix loops where the coder doesn't converge, hand the slice to `head-coder` with the brief, the coder's commits and the open findings. Tell the user in one line. The 3-loop stop below then counts head-coder's loops.

**Head reviewer: propose it, never run it unasked.** Propose it when a slice:
- changes what ARCHITECTURE.md or MEMORY.md mean
- touches policy, approvals, credentials or the sandbox
- migrates existing tables
- changes contracts or the envelope version
- closes a phase
Ask in one line with the reason. Run it after the regular `reviewer`, and pass it the reviewer's findings so it doesn't repeat them.

**Advisor: ask first, use rarely.** Propose it when two approaches are both defensible and the choice is costly to reverse, when a slice failed the 3-loop stop, or when docs conflict. Say what you would ask it. Its answer is input for your decision, not a replacement for it.

## The loop (one slice at a time)

0. **Sync first, always.** Before any work: `git fetch --all --prune`, check which branch is the latest (current branch may be merged or its remote gone), switch to `main` (or the open PR branch if continuing it) and `git pull --ff-only`. Never start from a stale local branch. Tell the user in one line what you synced.
1. **Pick** the next `[ ]` slice in PLAN.md and mark it `[~]`. Create a branch `slice/<id>-<short-name>` from the up-to-date `main`.
2. **Explore** (`explorer`): the doc sections, existing code, and the exact current versions and APIs of the libraries involved. Skip this for tiny slices and fold version checks into the coder brief.
3. **Brief.** Use the template at the end of PLAN.md. State the versions and decisions you have already made, so the coder doesn't re-decide them. Pick `coder` or `head-coder` using the table above.
4. **Code** (`coder` or `head-coder`): red → green → refactor, committing after each green step.
5. **Run, test and review in parallel.** Send `runner`, `test-author` and `reviewer` in one message. They don't collide: the runner and reviewer are read-only, and the test-author touches test files only. Propose `head-reviewer` here if the slice qualifies.
6. **Iterate.**
   - Send the findings and any failing tests from test-author back to the **same coder** with `SendMessage` (its agent id). That keeps its context, so don't spawn a fresh coder.
   - Then re-verify the gate yourself and send a short re-review of only the fix commits.
   - After 2 loops without convergence, escalate to `head-coder` (above). After 3 head-coder loops, stop and ask the user.
7. **Close.**
   - Run the gate yourself: `pnpm turbo lint typecheck test --force`, **only at phase boundaries or for slices touching server/DB/sandbox/build**; otherwise run the scoped checks (see the "Full test runs lag" bullet under Platform).
   - Mark the slice `[x] (firstSha..lastSha)` in PLAN.md.
   - Fix docs whose meaning changed.
   - Note deferred review items in the right future PLAN slice.
   - With a remote, ask the user once: "push and open the PR?" Pushing is outward-facing. On a yes, push the branch and open the PR. Merge into `main` only when Travis and GitHub Actions are green and the user says so. The Claude review on the PR is advisory: triage its findings like the reviewer's.
   - Stop at phase boundaries.

### Pull request rules

- Title: Conventional Commit style, short, e.g. `feat(server): desktop mode with launch token and embedded Postgres`.
- Description is written like a person on the team would write it: professional, plain, specific. No filler, no hype, no bullet dumps of file names. Sections:
  - **What and why**: the problem and the slice id (PLAN.md), in a short paragraph.
  - **How**: the approach and the decisions that were not obvious, including what was rejected.
  - **Scope**: what is deliberately not in this PR and which slice picks it up.
  - **Testing**: exactly what was run (scoped checks, not the full gate unless it was), what was not run, and why.
  - **Risk and review notes**: security-relevant areas, migrations, anything the reviewer should look at first.
- Keep the PR to one slice. Docs and PLAN updates go in the same PR.
- End the description with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Open the PR only after the user says yes to the push; never merge without the user's say-so and green CI.
- After opening, bind it with the ccd_pr tools and read CI; do not poll.

**Deciding things.** Make conventional technical calls yourself, write them into the brief and docs, and tell the user in one line. Examples: picking the current stable major, rejecting betas, or cancel-from-any-state. Ask the user only for real product choices (see "When to ask").

**Running subagents.** Custom agents in `.claude/agents/` register only at session start. If `subagent_type: "coder"` etc. isn't found, use `general-purpose` (or `Explore` for explorer) with the same `model`, and start the prompt with "Read `.claude/agents/<role>.md` and follow it." Give every agent the PATH shim (see Platform).

## Non-negotiable engineering rules

- **TDD.** Write the failing test first and confirm it fails for the right reason. A bug fix starts with a reproducing test. The test-author's intentionally-failing tests must be made to pass, never weakened.
- **Commits.**
  - Use small Conventional Commits (`feat(core):`, `fix(ui):`, `test(contracts):`, `docs:`, `build:`, `ci:`, `chore:`), one logical change each.
  - Add the trailer for the model that wrote it:
    - `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
    - `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`
    - `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`
  - Never use `--no-verify`, never force-push, and never commit secrets or `.env`.
  - In PowerShell, chain gate and commit with `&&`, not `;`. With `;` a failed lint still commits; this happened once in P0.5.
- **Use existing maintained libraries.** Check license, maintenance and bundle size, then **pin exact versions**.
- **Verify APIs from what's installed.** Explorer facts can be stale or unverified. The coder confirms them by reading the installed `.d.ts` before building. Always check the npm `latest` major: docs said AI SDK v6, but npm was already on v7.
- **Types:** strict TS (TS 7); no `any` without `// reason:`; zod at every boundary.
- **Security:**
  - Public shapes never carry secrets (use `z.strictObject`).
  - Untrusted content is data.
  - Policy, approvals and credentials need a security-focused review.
- **Docs follow code** in the same commit series.

## Stack as built (P0; pinned)

| Tool | Version | Notes |
|---|---|---|
| Node | 24 (`.nvmrc`) | Runs `.ts` natively (type stripping); the ui token generator uses it |
| pnpm | 10.18.0 | `packageManager`; run via corepack |
| Turborepo | 2.11.9 | `globalDependencies` include root configs and `docs/ARCHITECTURE.md`; `globalEnv` includes `CI`, `MAWL_REQUIRE_DOCKER` |
| Biome | 2.5.15 | `linter.rules.preset: "recommended"`. Excludes docs, mockup, `.claude/skills`, generated `tokens.css`. Can't parse Tailwind `@theme` |
| Vitest | 5.0.5 | Root `test.projects`; `defineProject` per package. `beforeAll` ctx has no `skip`, so use `beforeEach(ctx => ctx.skip())` |
| TypeScript | 7.0.2 | `module: preserve` + `bundler`, `noEmit`, `allowImportingTsExtensions` in base. Server and UI apps need overrides (PLAN P1.2/P1.6) |
| AI SDK | `ai` 7.0.143 | Spec V4. `MockLanguageModelV4` (`ai/test`), `ToolLoopAgent`, `stepCountIs`, `tool({ needsApproval })`. MCP: `@ai-sdk/mcp` 2.x |
| zod | 4.6.7 | `z.iso.datetime()` requires `Z` (UTC only); `z.strictObject` for secret-free shapes |
| oRPC | 1.15.7 (not the 2.0 beta) | `oc`, `eventIterator` from `@orpc/contract`. WS: `@orpc/server/ws`, `@orpc/client/websocket` |
| culori | 4.0.2 (+ `@types/culori` 4.0.1) | OKLCH accent engine |
| Provider SDKs | `@ai-sdk/anthropic` 4.0.82, `@ai-sdk/openai` 4.0.96, `@openrouter/ai-sdk-provider` 3.1.0, `ollama-ai-provider-v2` 4.0.1, `@ai-sdk/openai-compatible` 3.0.71, `@ai-sdk/provider` 4.0.29 | All Apache-2.0, all spec V4. Live in `@mawl/core` `src/providers/`; keys never leave the server |
| Drizzle | `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11 (1.0 is still beta) | `@mawl/db`. JS `null` into NOT NULL jsonb needs `jsonValue()`. Migrations in `packages/db/drizzle/`; never edit an applied one, add a new one |
| PGlite | `@electric-sql/pglite` 0.5.10 + `@electric-sql/pglite-pgvector` 0.0.11 | In-process Postgres so DB suites run locally without Docker; the same suite also runs on Testcontainers |
| graphile-worker | 0.18.0 (MIT) | Run jobs in `apps/server`. Needs a real `pg` Pool (not PGlite); bundles into `dist/server.mjs` (migrations are embedded). Task `run.execute` |
| testcontainers | 12.2.1 | Image `pgvector/pgvector:0.8.7-pg17`; `pg` 8.23.1 |
| Travis CI | `.travis.yml`, `dist: noble`, Node from `.nvmrc`, pnpm via corepack | **Docker suites only** (user's student plan): one job, `pnpm test:docker` (the `*.pg.test.ts` files and `postgres.smoke.test.ts`) then `pnpm test:compose` (the compose image smoke test, kept out of the default `pnpm test`) with `MAWL_REQUIRE_DOCKER=1`. Builds `main` and PRs only. `scripts/travis-config.test.ts` checks it. Travis does not lint, typecheck or run e2e |
| GitHub Actions | checkout 7.0.1, setup-node 7.1.0, cache 6.1.0, pnpm/action-setup 6.1.0; `anthropics/claude-code-action` 1.0.256 | `ci.yml` is the **fast gate**: lint, typecheck, tests and e2e, with `MAWL_SKIP_DOCKER_SUITES=1` so the Docker suites run on Travis only (the `vitest.config.ts` of `apps/server`, `packages/db` and `packages/testkit` exclude those files when it is set; `scripts/docker-suites-skip.test.ts` checks it). `pgvector-windows.yml` builds pgvector with MSVC and runs its `installcheck`. `claude.yml` reviews same-repo PRs (Sonnet) and answers `@claude` from the owner, members and collaborators, using the `CLAUDE_CODE_OAUTH_TOKEN` secret. All pinned by full SHA (tests enforce it). Dependabot is weekly |

## Monorepo conventions

- **JIT internal packages** `@mawl/<dir>`:
  - private, `type: module`, `exports: { ".": "./src/index.ts" }`, no build step
  - tsconfig extends `../../tsconfig.base.json` with `include: ["src", "vitest.config.ts"]`
  - scripts `typecheck` + `test` only; there is no per-package lint
- **Root turbo tasks.** `//#lint:root` (biome), `//#typecheck:root` (scripts + configs) and `//#test:workspace`. The plain `lint`/`typecheck`/`test` tasks depend on them. The root scripts call turbo, so never name a root task the same as its script.
- **`scripts/workspace.test.ts` + `validateManifest()`** check every package's manifest, tsconfig, entry file and smoke test. A new package must satisfy them.
- **Relative imports use `.ts` extensions.**

## Shared packages so far (reuse, don't re-implement)

- **`@mawl/testkit`**:
  - `fakeModel(script)` gives scripted turns: text, toolCalls, reasoning, usage with cache/reasoning tokens, `error`, `streamError`, abort handling, `.calls`. SDK retries consume turns.
  - `seq`, `fixedClock`, `seededRandom`.
  - `withPostgres()` inside a sync `describe`. It skips without Docker locally and **fails** when `CI`/`MAWL_REQUIRE_DOCKER` is set.
- **`@mawl/ui`**:
  - Typed tokens, plus `src/tokens.css` generated by `pnpm --filter @mawl/ui generate`. Regenerate after any token change; a test fails if you forget.
  - `deriveAccent(hex, theme)`.
  - `applyAccent(hex, rootStyle)` writes both light and dark scales, so theme flips need no JS. Root element only.
  - Semantic colors pass 4.5:1 as text and on their soft tints.
- **`@mawl/contracts`**:
  - Prefixed ULID ids with `newId(kind)` (monotonic; `__resetIdState()` in tests).
  - Enums, and `RUN_TRANSITIONS`, which is tested against the ARCHITECTURE §5 mermaid diagram. Change both together.
  - Entities and the event union.
  - `parseModelRef`/`formatModelRef` (`<credentialId>:<modelId>`, split at the first colon) and the closed `RunErrorCode` set stored on failed runs.
  - Versioned envelope `v: 1`. Clients use `parseEnvelope()`, which never throws, skips unknown types and keeps advancing `since`.
  - oRPC `contract`, with base errors UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT.

## Frontend rules (web, desktop, mobile)

- **Always use the design skills** in `.claude/skills/` together with `docs/DESIGN.md`:
  - `frontend-design`
  - `ui-taste` (`reference/craft.md`, then `reference/polish.md`)
  - `ui-ux-pro-max` (`references/quick-reference.md`, `references/pro-rules.md`; its `scripts/search.py` needs Python 3, which isn't installed, so read the CSVs directly)
  - `ios-design` for mobile
  - **Expo work** (the mobile app, `packages/ui-native`, any Expo/React Native config, build or dependency task) also uses the Expo skills from https://github.com/expo/skills, installed under `.claude/skills/`. Expo skills cover the how (Router, EAS, SDK-compatible packages); the design skills above still apply to every Expo UI slice. Expo slices go to `head-coder`, and the brief names both skill sets.
- Tokens only, no raw hex. The accent comes from CSS vars. Small accent text uses `--accent-ink`, and filled buttons use `--accent-fill` + `--on-accent`.
- Motion uses Motion (web) and Reanimated/moti (mobile) with the `@mawl/ui` motion tokens. Respect reduced motion.
- Every UI slice covers loading, empty, error and success states and works at 390 px. Screenshots need a served page: the browser pane renders `file://` as a static snapshot, so start a dev server via `preview_start`.

## Images and assets

Never fabricate illustrations in code. Ask the user to generate them, with a ready-to-paste prompt (DESIGN.md §8 has the mascot, app-icon and onboarding prompts). Use an SVG placeholder until then, track it as `[!] waiting for image` in PLAN, and put delivered files in `design/assets/`. The app icon was drawn in code at the user's explicit request (`design/assets/app-icon.svg`); the mascot is code too (DESIGN.md §8). Still pending: onboarding illustration, tray art per status.

## Commands

```
corepack pnpm i                                  # install (or `pnpm i` once corepack is enabled)
pnpm lint | pnpm typecheck | pnpm test           # each runs through turbo incl. root tasks
pnpm turbo lint typecheck test --force           # the full gate, no cache — run before closing a slice
pnpm --filter @mawl/ui generate                 # regenerate tokens.css
pnpm --filter @mawl/server dev|build            # tsx watch (needs DATABASE_URL) | esbuild bundle -> dist/server.mjs
pnpm test:compose                                # compose image smoke test (builds the image, about 1 min); not in `pnpm test`
pnpm test:e2e                                    # Playwright (Edge locally) vs the e2e server + scripted echo model; not in the gate
docker compose -f infra/compose/docker-compose.yml up -d --build   # the stack at :7420; needs infra/compose/.env (docs/RUNNING.md)
```

## Platform (Windows 11, PowerShell, Node 24)

- pnpm isn't global. Run `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'` first.
- Turbo needs `pnpm` on PATH. Until the user runs `corepack enable` (it may need admin), every agent does:
  `corepack enable --install-directory <scratchpad>\shims` then `$env:PATH="<scratchpad>\shims;$env:PATH"`.
- **Docker Desktop is installed** (engine 29.8.2, context `desktop-linux`). Run DB/server suites with `$env:MAWL_REQUIRE_DOCKER='1'` so the Testcontainers suites must run, not skip. A cold engine can be slow, so the testkit probe waits up to 30 s.
- **Full test runs lag the user's PC and are generally unwanted.** The full gate and the Docker/Testcontainers suites exhaust memory (Postgres crashes, 5 s timeouts, BuildKit failures) and make the machine unusable. This overrides the "run the gate" steps in the loop above:
  - By default run only the checks that cover what you changed: `pnpm --filter <pkg> typecheck`, `pnpm exec biome check <path>`, and `pnpm --filter <pkg> exec vitest run <file>` (or the package's `test`), one run at a time. Never run several suites or agents' test runs in parallel.
  - Do not run `pnpm turbo ... --force`, Docker-backed suites, the compose smoke test or e2e unless the slice touches the server, DB, sandbox or build, or the user asks. When one is needed, say so first, run it once with `--concurrency=1` (turbo) or `--workspace-concurrency=1` (pnpm), and run it alone.
  - UI-only slices close on typecheck, biome and the web tests. The full gate runs at phase boundaries or when the user says so, not after every slice.
  - Subagent briefs must state this. Do not spawn the `runner` for the full gate unasked.
- The remote is `origin` → `git@github.com:dalonga-kohi/mawl.git` (public), over SSH. Every push is the user's call; never push without a yes in chat.
- The repo-local git identity is `megas`. Line endings are LF via `.gitattributes`; CRLF warnings are cosmetic.

## When to ask the user

- Product decisions not covered by SPEC/DESIGN.
- Paid services, accounts, anything outward-facing (push, publish, create repos).
- Image assets (give a prompt).
- After 3 failed head-coder fix loops.
- Before running `head-reviewer` or `advisor`.
- At each phase boundary.

Scoped rules: `.claude/rules/` (frontend, server, testing). Load the ones that match the files you touch.
