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

## Token budget and other models

Full rules in [docs/WORKFLOW.md](docs/WORKFLOW.md). Short version:
- `docs/PLAN.md` is now an index plus versions and the slice template; each phase lives in `docs/plan/<phase>.md` (d1, d2, ...). Pick slices and mark status in the phase file, then update the index counts.
- Never read `docs/ARCHITECTURE.md` or a whole big phase file (`docs/plan/d1.md` is 39 KB); grep for the slice id or heading and read that range. The "Read before any work" list above means: know it exists, read the parts the slice needs.
- **Big research (more than one file or doc page of facts) goes to Gemini, not an agent.** Write `docs/research/<topic>.prompt.md`, ask the user to run it and save the answer as `docs/research/<topic>.md`, then read only that.
- **Light `coder`-class slices may go to Codex** (user-run, own branch and worktree) via `docs/handoffs/<id>.md`; `reviewer` still reviews them. Hard slices and UI stay with Claude.
- **The user takes** image assets, manual checks, product decisions and junior-level code on separate packages. Mark each pending slice `claude`, `codex` or `user` and keep lanes on different packages.

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

Full rules in [docs/PR-RULES.md](docs/PR-RULES.md); read it when opening a PR. Short version: Conventional Commit title, one slice per PR, push only after the user says yes, never merge without green CI and the user's say-so, bind the PR with the ccd_pr tools and do not poll CI.

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

## Stack, monorepo conventions, shared packages

Pinned versions, the monorepo conventions and the shared-package catalog (testkit, ui, contracts) are in [docs/STACK.md](docs/STACK.md). Read it before adding a dependency or package, and reuse the shared packages instead of re-implementing. Key facts: Node 24, pnpm 10 via corepack, TS 7 strict, Vitest 5, Biome, zod 4, JIT internal packages @mawl/<dir>, relative imports use .ts extensions.

## Frontend rules (web, desktop, mobile)

- **Always use the design skills** in `.claude/skills/` together with `docs/DESIGN.md`:
  - `frontend-design`
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
