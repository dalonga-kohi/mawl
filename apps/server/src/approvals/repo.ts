import type { Approval, ApprovalId, Json, ProfileId, RunId } from '@mawl/contracts'
import { schema } from '@mawl/db'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { type Queryable, recordEvent } from '../runs/repo.ts'

const { approvals, runWaits } = schema

/** `<table>:<id>`: binds the encrypted arguments to their own row (see SecretBox). */
export const approvalAad = (id: ApprovalId) => `approvals:${id}`

/**
 * The only columns a public (API or event) read of an approval may select. Never `args_enc` or
 * `args_hash`: the stored call stays on the server.
 */
export const approvalPublicColumns = {
  id: approvals.id,
  profileId: approvals.profileId,
  runId: approvals.runId,
  stepIdx: approvals.stepIdx,
  toolCallId: approvals.toolCallId,
  tool: approvals.tool,
  argsRedacted: approvals.argsRedacted,
  actionClass: approvals.actionClass,
  reason: approvals.reason,
  status: approvals.status,
  decidedByDevice: approvals.decidedByDevice,
  decidedViaChannel: approvals.decidedViaChannel,
  createdAt: approvals.createdAt,
  expiresAt: approvals.expiresAt,
  decidedAt: approvals.decidedAt,
}

export type ApprovalPublicRow = Omit<typeof approvals.$inferSelect, 'argsEnc' | 'argsHash'>

const isRecord = (v: Json): v is { [key: string]: Json } =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** A row as the contract's strict `Approval`. Redacted arguments that are not an object show as `{}`. */
export function toApproval(row: ApprovalPublicRow): Approval {
  return {
    id: row.id,
    profileId: row.profileId,
    runId: row.runId,
    stepIdx: row.stepIdx,
    toolCallId: row.toolCallId,
    tool: row.tool,
    argsRedacted: isRecord(row.argsRedacted) ? row.argsRedacted : {},
    actionClass: row.actionClass,
    reason: row.reason,
    status: row.status,
    // reason: the column is text; only device ids are ever written to it.
    decidedByDevice: row.decidedByDevice as Approval['decidedByDevice'],
    decidedViaChannel: row.decidedViaChannel,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  }
}

/**
 * Inside the caller's transaction (the run row already locked or just moved out of
 * `waiting_approval`): resolves the run's pending approvals as `cancelled`, closes their waits and
 * records one `approval.resolved` event each. Nothing runs and no tool result is recorded: the
 * run is over.
 */
export async function cancelPendingApprovals(
  tx: Queryable,
  run: { id: RunId; profileId: ProfileId },
): Promise<void> {
  const closed = await tx
    .update(approvals)
    .set({ status: 'cancelled', decidedAt: sql`now()` })
    .where(and(eq(approvals.runId, run.id), eq(approvals.status, 'pending')))
    .returning({ id: approvals.id })
  if (closed.length === 0) return
  await tx
    .update(runWaits)
    .set({ answer: { decision: 'cancelled' }, resolvedAt: sql`now()` })
    .where(
      and(eq(runWaits.runId, run.id), eq(runWaits.kind, 'approval'), isNull(runWaits.resolvedAt)),
    )
  for (const { id } of closed) {
    await recordEvent(tx, {
      profileId: run.profileId,
      runId: run.id,
      type: 'approval.resolved',
      payload: { approvalId: id, status: 'cancelled' },
    })
  }
}
