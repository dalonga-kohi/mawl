---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.spec.ts"
  - "**/e2e/**"
  - "packages/testkit/**"
---

# Testing rules

- TDD. Write a failing test, confirm it fails for the right reason, implement, see it pass, refactor. Commit at each green step.
- Test pyramid:
  - unit: pure logic (policy matrix, RRF math, accent engine, schedulers)
  - integration: Testcontainers Postgres, the run engine with the fake model, the WS hub
  - e2e: Playwright against web with the fake provider
  - mobile e2e: Maestro (later)
- Never call real LLM providers in CI tests. Use `packages/testkit` `fakeModel()` scripts. Real-model evals run separately (`pnpm eval`) and are opt-in.
- Tests must be deterministic: no sleeps (use fake timers and `vi.waitFor`), seeded IDs, frozen clocks for time-based memory logic.
- Name tests by behavior: `it('rejects a block edit that exceeds the cap and reports fill level')`.
- UI tests query by role and label (Testing Library). No test IDs unless there is no accessible handle.
- Visual checks: Playwright screenshots at 1280×800 and 390×844, light and dark, plus reduced-motion. Baselines live in the repo, and any baseline update needs a reason in the commit.
- Coverage is a signal, not a goal. Every public function in `core`, `memory` and `policy` needs a direct test.
