# Pull request rules

Moved out of CLAUDE.md to save tokens; read when opening a PR.

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
