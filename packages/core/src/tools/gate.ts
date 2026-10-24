import type { ToolGate } from './types.ts'

/**
 * Allows every call. A placeholder only: D2.3 replaces it with the policy engine (action classes,
 * levels, rule precedence, the non-lowerable classes). Every call still goes through `check`, so
 * swapping the gate is the whole change.
 */
export const allowAllGate: ToolGate = {
  check: async () => ({ decision: 'allow' }),
}
