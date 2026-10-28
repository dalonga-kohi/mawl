# Mawl: guide for Codex and other non-Claude agents

Same repo rules as `CLAUDE.md`; read its "Non-negotiable engineering rules", "Monorepo conventions" and "Platform" sections. Ignore the parts about Claude subagents, caveman voice and the orchestrator loop.

- Do exactly the slice in your handoff file (`docs/handoffs/<id>.md`). Touch nothing outside its scope.
- Do not read all of `docs/PLAN.md` or `docs/ARCHITECTURE.md`; use only the excerpts and line ranges the handoff names.
- Strict TDD, small Conventional Commits, no `--no-verify`, no force-push, no secrets.
- Run scoped checks only (typecheck, biome on changed paths, the one vitest file). Do not run the full gate or Docker suites.
- Do not edit `docs/PLAN.md`. Do not push; the user does.
- Commit trailer: `Co-Authored-By: Codex <noreply@openai.com>`
- Workflow background: `docs/WORKFLOW.md`.
