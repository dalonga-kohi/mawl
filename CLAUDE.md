# Faire — guide for Claude

Faire is a self-hosted, always-on agent app ("AI teammates you own"). It has:
- a Docker stack (server + Postgres + one sandbox computer per profile)
- a Tauri 2 desktop app, an Expo mobile app, and Telegram/Discord channels
- a long-horizon memory system

**Read before any work:**
- [docs/SPEC.md](docs/SPEC.md): what and why
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how
- [docs/MEMORY.md](docs/MEMORY.md): memory and context
- [docs/PLAN.md](docs/PLAN.md): what's next, with status
- [docs/DESIGN.md](docs/DESIGN.md): look and feel

## Voice: caveman skill, always on (default mode)

Every agent (orchestrator, explorer, coder, tester, reviewer) uses the **`caveman`** skill (`.claude/skills/caveman/SKILL.md`) in its default mode for chat, status lines and subagent reports.
- Default mode only: not `ultracave` or `megacave` unless the user asks.
- Per the skill, these stay normal, full prose:
  - anything persisted (code, comments, commit messages, docs, PLAN updates, UI copy)
  - security warnings and irreversible-action confirmations
  - questions to the user
- Code, commands, paths, versions and error strings stay verbatim.
- The user can say "stop caveman" or "normal mode" to switch it off.

## Roles

- **You (the main session, Opus): orchestrator and planner.** You own PLAN.md, slice the work, write the briefs, dispatch subagents, judge their results and keep the docs true. Do small glue edits yourself (doc fixes, one-line config), and delegate real implementation.
- **`explorer` (Haiku):** read-only context and current library facts.
- **`coder` (Sonnet):** implements one slice with TDD and commits.
- **`tester` (Sonnet):** runs the gate, mutation-checks the tests, adds edge-case tests, and does visual checks. It never edits production code.
- **`reviewer` (Sonnet):** read-only review of a commit range. Returns findings ranked by severity.

## The loop (one slice at a time)

1. **Pick** the next `[ ]` slice in PLAN.md and mark it `[~]`.
2. **Explore** (`explorer`): the doc sections, existing code, and the exact current versions and APIs of the libraries involved. Skip this for tiny slices and fold version checks into the coder brief.
3. **Brief.** Use the template at the end of PLAN.md. State the versions and decisions you have already made, so the coder doesn't re-decide them.
4. **Code** (`coder`): red → green → refactor, committing after each green step.
5. **Test + review in parallel.** `tester` and `reviewer` touch different things (test files vs read-only), so send both in one message.
6. **Iterate.**
   - Send the findings back to the **same coder** with `SendMessage` (its agent id). That keeps its context, so don't spawn a fresh coder.
   - Then re-verify the gate yourself and send a short re-review of only the fix commits.
   - After 3 loops without convergence, stop and ask the user.
7. **Close.**
   - Run the gate yourself: `pnpm turbo lint typecheck test --force`.
   - Mark the slice `[x] (firstSha..lastSha)` in PLAN.md.
   - Fix docs whose meaning changed.
   - Note deferred review items in the right future PLAN slice.
   - Stop at phase boundaries.

**Deciding things.** Make conventional technical calls yourself, write them into the brief and docs, and tell the user in one line. Examples: picking the current stable major, rejecting betas, or cancel-from-any-state. Ask the user only for real product choices (see "When to ask").

**Running subagents.** Custom agents in `.claude/agents/` register only at session start. If `subagent_type: "coder"` etc. isn't found, use `general-purpose` (or `Explore` for explorer) with the same `model`, and start the prompt with "Read `.claude/agents/<role>.md` and follow it." Give every agent the PATH shim (see Platform).

## Non-negotiable engineering rules

- **TDD.** Write the failing test first and confirm it fails for the right reason. A bug fix starts with a reproducing test. The tester's intentionally-failing tests must be made to pass, never weakened.
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
| Turborepo | 2.11.9 | `globalDependencies` include root configs and `docs/ARCHITECTURE.md`; `globalEnv` includes `CI`, `FAIRE_REQUIRE_DOCKER` |
| Biome | 2.5.15 | `linter.rules.preset: "recommended"`. Excludes docs, mockup, `.claude/skills`, generated `tokens.css`. Can't parse Tailwind `@theme` |
| Vitest | 5.0.5 | Root `test.projects`; `defineProject` per package. `beforeAll` ctx has no `skip`, so use `beforeEach(ctx => ctx.skip())` |
| TypeScript | 7.0.2 | `module: preserve` + `bundler`, `noEmit`, `allowImportingTsExtensions` in base. Server and UI apps need overrides (PLAN P1.2/P1.6) |
| AI SDK | `ai` 7.0.143 | Spec V4. `MockLanguageModelV4` (`ai/test`), `ToolLoopAgent`, `stepCountIs`, `tool({ needsApproval })`. MCP: `@ai-sdk/mcp` 2.x |
| zod | 4.6.7 | `z.iso.datetime()` requires `Z` (UTC only); `z.strictObject` for secret-free shapes |
| oRPC | 1.15.7 (not the 2.0 beta) | `oc`, `eventIterator` from `@orpc/contract`. WS: `@orpc/server/ws`, `@orpc/client/websocket` |
| culori | 4.0.2 (+ `@types/culori` 4.0.1) | OKLCH accent engine |
| Drizzle | `drizzle-orm` 0.45.4, `drizzle-kit` 0.31.11 (1.0 is still beta) | `@faire/db`. JS `null` into NOT NULL jsonb needs `jsonValue()`. Migrations in `packages/db/drizzle/`; never edit an applied one, add a new one |
| PGlite | `@electric-sql/pglite` 0.5.10 + `@electric-sql/pglite-pgvector` 0.0.11 | In-process Postgres so DB suites run locally without Docker; the same suite also runs on Testcontainers |
| testcontainers | 12.2.1 | Image `pgvector/pgvector:0.8.7-pg17`; `pg` 8.23.1 |
| GitHub Actions | checkout 7.0.1, setup-node 7.1.0, cache 6.1.0, pnpm/action-setup 6.1.0 | Pinned by full SHA (a test enforces it) |

## Monorepo conventions

- **JIT internal packages** `@faire/<dir>`:
  - private, `type: module`, `exports: { ".": "./src/index.ts" }`, no build step
  - tsconfig extends `../../tsconfig.base.json` with `include: ["src", "vitest.config.ts"]`
  - scripts `typecheck` + `test` only; there is no per-package lint
- **Root turbo tasks.** `//#lint:root` (biome), `//#typecheck:root` (scripts + configs) and `//#test:workspace`. The plain `lint`/`typecheck`/`test` tasks depend on them. The root scripts call turbo, so never name a root task the same as its script.
- **`scripts/workspace.test.ts` + `validateManifest()`** check every package's manifest, tsconfig, entry file and smoke test. A new package must satisfy them.
- **Relative imports use `.ts` extensions.**

## Shared packages so far (reuse, don't re-implement)

- **`@faire/testkit`**:
  - `fakeModel(script)` gives scripted turns: text, toolCalls, reasoning, usage with cache/reasoning tokens, `error`, `streamError`, abort handling, `.calls`. SDK retries consume turns.
  - `seq`, `fixedClock`, `seededRandom`.
  - `withPostgres()` inside a sync `describe`. It skips without Docker locally and **fails** when `CI`/`FAIRE_REQUIRE_DOCKER` is set.
- **`@faire/ui`**:
  - Typed tokens, plus `src/tokens.css` generated by `pnpm --filter @faire/ui generate`. Regenerate after any token change; a test fails if you forget.
  - `deriveAccent(hex, theme)`.
  - `applyAccent(hex, rootStyle)` writes both light and dark scales, so theme flips need no JS. Root element only.
  - Semantic colors pass 4.5:1 as text and on their soft tints.
- **`@faire/contracts`**:
  - Prefixed ULID ids with `newId(kind)` (monotonic; `__resetIdState()` in tests).
  - Enums, and `RUN_TRANSITIONS`, which is tested against the ARCHITECTURE §5 mermaid diagram. Change both together.
  - Entities and the event union.
  - Versioned envelope `v: 1`. Clients use `parseEnvelope()`, which never throws, skips unknown types and keeps advancing `since`.
  - oRPC `contract`, with base errors UNAUTHORIZED, FORBIDDEN, VALIDATION, NOT_FOUND, CONFLICT.

## Frontend rules (web, desktop, mobile)

- **Always use the design skills** in `.claude/skills/` together with `docs/DESIGN.md`:
  - `frontend-design`
  - `ui-taste` (`reference/craft.md`, then `reference/polish.md`)
  - `ui-ux-pro-max` (`references/quick-reference.md`, `references/pro-rules.md`; its `scripts/search.py` needs Python 3, which isn't installed, so read the CSVs directly)
  - `ios-design` for mobile
- Tokens only, no raw hex. The accent comes from CSS vars. Small accent text uses `--accent-ink`, and filled buttons use `--accent-fill` + `--on-accent`.
- Motion uses Motion (web) and Reanimated/moti (mobile) with the `@faire/ui` motion tokens. Respect reduced motion.
- Every UI slice covers loading, empty, error and success states and works at 390 px. Screenshots need a served page: the browser pane renders `file://` as a static snapshot, so start a dev server via `preview_start`.

## Images and assets

Never fabricate illustrations in code. Ask the user to generate them, with a ready-to-paste prompt (DESIGN.md §8 has the mascot, app-icon and onboarding prompts). Use an SVG placeholder until then, track it as `[!] waiting for image` in PLAN, and put delivered files in `design/assets/`. Still pending: Pip mascot sheet, app icon, onboarding illustration.

## Commands

```
corepack pnpm i                                  # install (or `pnpm i` once corepack is enabled)
pnpm lint | pnpm typecheck | pnpm test           # each runs through turbo incl. root tasks
pnpm turbo lint typecheck test --force           # the full gate, no cache — run before closing a slice
pnpm --filter @faire/ui generate                 # regenerate tokens.css
pnpm --filter @faire/server dev|build            # tsx watch (needs DATABASE_URL) | esbuild bundle -> dist/server.mjs
pnpm test:e2e / pnpm db:migrate                # arrive in P1
```

## Platform (Windows 11, PowerShell, Node 24)

- pnpm isn't global. Run `$env:COREPACK_ENABLE_DOWNLOAD_PROMPT='0'` first.
- Turbo needs `pnpm` on PATH. Until the user runs `corepack enable` (it may need admin), every agent does:
  `corepack enable --install-directory <scratchpad>\shims` then `$env:PATH="<scratchpad>\shims;$env:PATH"`.
- **Docker Desktop is installed** (engine 29.8.2, context `desktop-linux`). Run DB/server suites with `$env:FAIRE_REQUIRE_DOCKER='1'` so the Testcontainers suites must run, not skip. A cold engine can be slow, so the testkit probe waits up to 30 s.
- There's no git remote, so CI has never actually run. Pushing or creating a repo is the user's call.
- The repo-local git identity is `megas`. Line endings are LF via `.gitattributes`; CRLF warnings are cosmetic.

## When to ask the user

- Product decisions not covered by SPEC/DESIGN.
- Paid services, accounts, anything outward-facing (push, publish, create repos).
- Image assets (give a prompt).
- After 3 failed fix loops.
- At each phase boundary.

Scoped rules: `.claude/rules/` (frontend, server, testing). Load the ones that match the files you touch.
