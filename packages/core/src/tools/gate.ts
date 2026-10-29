import type { ToolGate } from './types.ts'

/**
 * Allows every call. For tests and the tool-less registry only: production registries pass the
 * policy engine (`policyGate` in `core/policy`), which the server wires in `createServerTools`.
 */
export const allowAllGate: ToolGate = {
  check: async () => ({ decision: 'allow' }),
  checkRedirect: async () => true,
}

/** Refuses every call. For a registry that should never run anything (the engine's empty one). */
export const denyAllGate: ToolGate = {
  check: async () => ({ decision: 'deny', reason: 'No tools are available to this run.' }),
}
