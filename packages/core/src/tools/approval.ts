import { createHash } from 'node:crypto'
import type { Json } from '@mawl/contracts'
import { errorRecord } from './registry.ts'
import type { ApprovedCall, Tool, ToolResultRecord } from './types.ts'

/** A pending approval resolves as `expired` (a denial for the model) after this. */
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The exact text an approval stores and replays: the parsed arguments as JSON. `prepare` already
 * made them plain JSON, so this is deterministic for one call (key order is the schema's).
 * `JSON.stringify` escapes lone surrogates and control characters, so the text is well-formed.
 */
export function canonicalArgs(args: Json): string {
  return JSON.stringify(args)
}

/** SHA-256 of the stored argument text, hex. Checked before any replay. */
export function argsHash(argsText: string): string {
  return createHash('sha256').update(argsText, 'utf8').digest('hex')
}

/**
 * The call an approval lets run, or null when anything does not match (fail closed): the grant is
 * unreadable, names another tool, its text does not match its hash, the model's recorded call is
 * not the approved one, or the stored text does not parse back to exactly itself. On success the
 * returned run uses the stored arguments, never the model's copy.
 */
export function replayApproved(
  tool: Tool,
  grant: ApprovedCall,
  current: { args: Json },
): Extract<ReturnType<Tool['prepare']>, { ok: true }> | null {
  if (grant.status !== 'approved') return null
  if (grant.tool !== tool.name) return null
  if (argsHash(grant.argsText) !== grant.argsHash) return null
  if (canonicalArgs(current.args) !== grant.argsText) return null
  let raw: unknown
  try {
    raw = JSON.parse(grant.argsText)
  } catch {
    return null
  }
  const again = tool.prepare(raw)
  if (!again.ok || canonicalArgs(again.args) !== grant.argsText) return null
  return again
}

/** Why a parked call was not run, as the model sees it. */
export type ApprovalRefusal = 'denied' | 'expired'

/** The result the model gets when the owner denied the call or the approval expired. */
export function approvalRefusedRecord(toolName: string, why: ApprovalRefusal): ToolResultRecord {
  return errorRecord(
    toolName,
    'denied',
    why === 'denied'
      ? 'The owner denied this call, so it was not run. Do not retry it; continue without it or ask the owner.'
      : 'The approval request expired without an answer, so the call was not run. Continue without it or ask the owner.',
  )
}
