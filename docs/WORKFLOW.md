# Multi-model workflow and token budget

Claude (orchestrator + subagents) is the scarce resource. Codex (ChatGPT) and Gemini take work that does not need Claude, and the user takes the rest.

## Lanes

| Lane | Does | Never |
|---|---|---|
| Claude orchestrator | Slicing, briefs, PLAN.md, judging results, hard slices (`head-coder`), UI (`head-coder`) | Reads whole big docs; does bulk research |
| Codex (user runs it) | Light `coder`-class slices: single-package features, fixes, wiring, config, docs-heavy work | Hard slices (see CLAUDE.md), UI, migrations, policy/credentials/sandbox |
| Gemini (user runs it) | Big research: library usage, guidelines, comparisons, "how do others do X" | Decisions. It returns facts; Claude decides |
| User | Image assets, manual checks, product decisions, junior-level code on its own branch, pasting Gemini answers | |

Codex is not installed on this machine yet. Until it is, handoffs are files the user pastes into ChatGPT/Codex.

## Claude rules for saving tokens

1. **Never read `docs/PLAN.md` or `docs/ARCHITECTURE.md` whole** (about 26k tokens each). Grep for the slice id or section heading, then read that range only. Briefs quote the needed lines, so agents need no more.
2. **Big research goes to Gemini, not to an agent.** If a task needs more than one file or one doc page of facts, write `docs/research/<topic>.prompt.md` and ask the user to run it. Agents then read `docs/research/<topic>.md` only. Single-API checks (read the installed `.d.ts`) stay with the coder.
3. **Skip `explorer` for small slices.** Put paths and line ranges in the brief instead.
4. **No `runner` for the full gate** unless CLAUDE.md allows it. Scoped checks only.
5. **Reuse agents with `SendMessage`** for fix loops; never respawn.
6. **Design skills load only for UI slices** (`head-coder` preloads them; `coder` does not).
7. Subagent reports stay at or under the word limits in their agent files. Do not ask for more.

## Gemini research handoff

1. Claude writes `docs/research/<topic>.prompt.md`: the question, what the project already decided (versions, stack), the exact output format (short, cited, version-specific, no code beyond snippets), and "say unknown instead of guessing".
2. User runs it in Gemini, saves the answer as `docs/research/<topic>.md`.
3. Claude treats the answer as data to verify: library APIs are still checked against the installed `.d.ts`.

## Codex handoff

1. Only slices the table above gives to `coder` qualify, and only when no other lane touches the same package.
2. Claude writes `docs/handoffs/<slice-id>.md` using the template below, from `main` on branch `slice/<id>-codex`.
3. User opens that branch (own worktree: `git worktree add ..\mawl-<id> -b slice/<id>-codex main`), runs Codex with: "Read AGENTS.md and docs/handoffs/<id>.md, then do it."
4. Claude reviews the commit range with `reviewer` (Sonnet) before it is marked `[x]`. Codex output is not trusted without review.

### Handoff template

```
# <slice id>: <name>
Branch: slice/<id>-codex   Base: main
Goal (2-3 lines):
Files/packages in scope (touch nothing else):
Pinned versions and decisions already made:
Doc excerpts (quoted, not linked):
TDD: write the failing test first. Commit per green step, Conventional Commits.
Checks to run (scoped only): pnpm --filter <pkg> typecheck; pnpm exec biome check <path>; pnpm --filter <pkg> exec vitest run <file>
Done when:
Report: list of commits, tests added, anything deferred. Do not edit docs/PLAN.md.
```

## Parallel lanes per phase

When picking slices, Claude marks each pending slice in the PLAN as `claude`, `codex` or `user` and keeps lanes on different packages, so branches never conflict.
