import type {
  Approval,
  ApprovalId,
  ApprovalStatus,
  DeviceId,
  ProfileId,
  RunId,
} from '@mawl/contracts'
import { approvalRefusedRecord } from '@mawl/core'
import { schema } from '@mawl/db'
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import { insertToolResult, type Queryable, recordEvent } from '../runs/repo.ts'
import { approvalPublicColumns, toApproval } from './repo.ts'

const { approvals, runs, runWaits } = schema

const DEFAULT_LIST_LIMIT = 50
/** Approvals one sweep expires; the next sweep takes the rest. */
const EXPIRE_BATCH = 100

export class ApprovalNotFoundError extends Error {
  constructor(readonly id: string) {
    super('approval not found')
    this.name = 'ApprovalNotFoundError'
  }
}

/** The approval is no longer pending (or ran out before this decision); carries its status. */
export class ApprovalConflictError extends Error {
  constructor(readonly status: ApprovalStatus) {
    super(`approval is ${status}`)
    this.name = 'ApprovalConflictError'
  }
}

/** Who decided: the owner's device (none before pairing, D8.1) and the channel. */
export interface DecidedBy {
  deviceId: DeviceId | null
  via: 'app'
}

export interface ApprovalServiceDeps {
  db: ProvidersDb
  /** Hands the resumed run to the job queue. A failure is logged; boot recovery picks it up. */
  enqueue(runId: RunId): Promise<void>
  logger: Logger
}

export interface ApprovalService {
  list(input?: {
    profileId?: ProfileId | undefined
    status?: ApprovalStatus | undefined
    limit?: number | undefined
  }): Promise<Approval[]>
  get(id: ApprovalId): Promise<Approval>
  /**
   * Approve or deny a pending approval and resume its run. Approve leaves the stored call for the
   * replay; deny records the refusal as the call's result. An approval past its expiry is
   * resolved as `expired` (a denial) instead, and CONFLICT `expired` is thrown after the commit.
   */
  decide(id: ApprovalId, decision: 'approve' | 'deny', by: DecidedBy): Promise<Approval>
  /** Resolves every pending approval past its expiry as `expired` and resumes the runs. */
  expireDue(): Promise<number>
}

type Outcome = 'approved' | 'denied' | 'expired'

/**
 * Locks the run, then the approval (the same order a cancel takes: run row first), and resolves
 * it when it is still pending. Returns what happened, or the status that made it a conflict.
 */
async function resolve(
  tx: Queryable,
  id: ApprovalId,
  want: (expired: boolean) => Outcome | null,
  by: DecidedBy | null,
): Promise<{ outcome: Outcome; runId: RunId } | { conflict: ApprovalStatus } | null> {
  const [peek] = await tx
    .select({ runId: approvals.runId })
    .from(approvals)
    .where(eq(approvals.id, id))
  if (!peek) return null
  const [run] = await tx
    .select({ id: runs.id, profileId: runs.profileId, status: runs.status })
    .from(runs)
    .where(eq(runs.id, peek.runId))
    .for('update')
  const [row] = await tx
    .select({
      tool: approvals.tool,
      status: approvals.status,
      stepIdx: approvals.stepIdx,
      toolCallId: approvals.toolCallId,
      expired: sql<boolean>`${approvals.expiresAt} <= now()`,
    })
    .from(approvals)
    .where(eq(approvals.id, id))
    .for('update')
  if (!run || !row) return null
  if (row.status !== 'pending') return { conflict: row.status }
  // A pending approval always belongs to a waiting run (a cancel resolves it in the same
  // transaction); anything else is refused rather than guessed at.
  if (run.status !== 'waiting_approval') return { conflict: row.status }
  const outcome = want(row.expired)
  if (outcome === null) return { conflict: row.status }

  await tx
    .update(approvals)
    .set({
      status: outcome,
      decidedAt: sql`now()`,
      ...(by ? { decidedByDevice: by.deviceId, decidedViaChannel: by.via } : {}),
    })
    .where(eq(approvals.id, id))
  await tx
    .update(runWaits)
    .set({ answer: { decision: outcome }, resolvedAt: sql`now()` })
    .where(
      and(
        eq(runWaits.runId, run.id),
        eq(runWaits.stepIdx, row.stepIdx),
        eq(runWaits.toolCallId, row.toolCallId),
        isNull(runWaits.resolvedAt),
      ),
    )
  if (outcome !== 'approved') {
    const key = { stepIdx: row.stepIdx, toolCallId: row.toolCallId }
    await insertToolResult(
      tx,
      run.id,
      key,
      approvalRefusedRecord(row.tool, outcome === 'denied' ? 'denied' : 'expired'),
      [],
    )
  }
  await tx.update(runs).set({ status: 'running' }).where(eq(runs.id, run.id))
  await recordEvent(tx, {
    profileId: run.profileId,
    runId: run.id,
    type: 'run.status',
    payload: { status: 'running', prevStatus: 'waiting_approval' },
  })
  await recordEvent(tx, {
    profileId: run.profileId,
    runId: run.id,
    type: 'approval.resolved',
    payload: { approvalId: id, status: outcome, ...(by ? { via: by.via } : {}) },
  })
  return { outcome, runId: run.id }
}

/**
 * The owner's approvals. Never reachable from a tool: only the owner-authenticated RPC calls it,
 * and a decision cannot change the parked call (approve replays the stored arguments).
 */
export function createApprovalService({
  db,
  enqueue,
  logger,
}: ApprovalServiceDeps): ApprovalService {
  async function enqueueQuietly(runId: RunId): Promise<void> {
    try {
      await enqueue(runId)
    } catch (err) {
      // Name only. The run is durable and running; boot recovery re-enqueues it.
      logger.error(
        { runId, errName: err instanceof Error ? err.name : 'unknown' },
        'could not enqueue run',
      )
    }
  }

  async function get(id: ApprovalId): Promise<Approval> {
    const [row] = await db.select(approvalPublicColumns).from(approvals).where(eq(approvals.id, id))
    if (!row) throw new ApprovalNotFoundError(id)
    return toApproval(row)
  }

  return {
    async list(input = {}) {
      const rows = await db
        .select(approvalPublicColumns)
        .from(approvals)
        .where(
          and(
            input.profileId ? eq(approvals.profileId, input.profileId) : undefined,
            input.status ? eq(approvals.status, input.status) : undefined,
          ),
        )
        .orderBy(desc(approvals.createdAt), desc(approvals.id))
        .limit(input.limit ?? DEFAULT_LIST_LIMIT)
      return rows.map(toApproval)
    },

    get,

    async decide(id, decision, by) {
      const result = await db.transaction((tx) =>
        resolve(
          tx,
          id,
          (expired) => (expired ? 'expired' : decision === 'approve' ? 'approved' : 'denied'),
          by,
        ),
      )
      if (result === null) throw new ApprovalNotFoundError(id)
      if ('conflict' in result) throw new ApprovalConflictError(result.conflict)
      await enqueueQuietly(result.runId)
      if (result.outcome === 'expired') throw new ApprovalConflictError('expired')
      return get(id)
    },

    async expireDue() {
      const due = await db
        .select({ id: approvals.id })
        .from(approvals)
        .where(and(eq(approvals.status, 'pending'), lte(approvals.expiresAt, sql`now()`)))
        .orderBy(approvals.expiresAt)
        .limit(EXPIRE_BATCH)
      let expired = 0
      for (const { id } of due) {
        const result = await db.transaction((tx) =>
          resolve(tx, id, (isExpired) => (isExpired ? 'expired' : null), null),
        )
        if (result && 'outcome' in result) {
          expired++
          await enqueueQuietly(result.runId)
        }
      }
      if (expired > 0) logger.info({ approvals: expired }, 'expired pending approvals')
      return expired
    },
  }
}
