---
paths:
  - "apps/server/**"
  - "packages/core/**"
  - "packages/memory/**"
  - "packages/db/**"
  - "packages/sandbox/**"
  - "packages/channels/**"
  - "packages/contracts/**"
  - "infra/**"
---

# Server and runtime rules

- Every external input is validated with zod from `packages/contracts`: API, WS, tool args, channel messages, env.
- Runs are durable. Persist each step before starting the next one. Waiting states (approval, takeover, user) end the job, and a new job resumes the run. Jobs must be idempotent: dedupe on `(run_id, step_idx)`.
- Policy is checked in exactly one place (`core/policy`). Never call a tool without going through the policy engine. `credential` and payment classes are always `handoff`.
- Secrets are encrypted with libsodium at rest. They are never logged, never placed in model context or URLs, and are redacted in events and audit records.
- The sandbox is untrusted. It sits on its own Docker network and has no route to Postgres or the docker proxy. Reach it only via `SandboxProvider`.
- Tool results and web/MCP content go into context wrapped as untrusted data. Memory writes go through the injection scanner.
- Keep the prompt prefix byte-stable within a segment, because cache hits matter. Changing the prompt layout requires updating MEMORY.md §7 and the snapshot tests.
- Large outputs go to artifacts. Never put more than about 4k tokens of raw tool output into context.
- DB changes go through Drizzle migrations only. Add indexes for each new query path. Use Testcontainers for integration tests.
- Use the AI SDK v6 APIs as documented now: confirm with `explorer` before use, and don't rely on memory.
- Logging uses pino with structured fields `{profileId, runId, step}`. No `console.log` in committed code.
