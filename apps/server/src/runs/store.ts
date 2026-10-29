import {
  canTransition,
  type Json,
  newId,
  type RunId,
  type RunStatus,
  type Usage,
} from '@mawl/contracts'
import {
  APPROVAL_TTL_MS,
  type AppendResult,
  type ApprovedCall,
  type ModelMessage,
  type NewStep,
  type NewToolStep,
  type PersistedStep,
  type RunContext,
  type RunRecord,
  type RunStore,
  type RunWait,
  type ToolCallKey,
  type ToolResultRecord,
  type TransitionPatch,
} from '@mawl/core'
import { schema } from '@mawl/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  type ApprovalPublicRow,
  approvalAad,
  approvalPublicColumns,
  cancelPendingApprovals,
  toApproval,
} from '../approvals/repo.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { SecretBox } from '../secrets/index.ts'
import {
  insertRunStep,
  insertToolResult,
  type Queryable,
  recordEvent,
  toToolRecord,
} from './repo.ts'

const { runs, profiles, messages, threads, runSteps, runWaits, toolResults, approvals, jsonValue } =
  schema

/** Most recent messages sent to the model. A stopgap until context assembly (P3.5). */
export const HISTORY_LIMIT = 200

/** What `appendStep` stores in `run_steps.input_json`. Only assistant and tool messages. */
const StepInput = z.object({
  messages: z.array(z.looseObject({ role: z.enum(['assistant', 'tool']) })),
})

const isRecord = (v: Json): v is { [key: string]: Json } =>
  v !== null && typeof v === 'object' && !Array.isArray(v)

/** Round-trips through JSON so the value is plain JSON (no undefined), as jsonb stores it. */
function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

/**
 * Locks the run row and returns it only while it is unning: a cancel or pause that commits first
 * is seen here, and one that arrives later waits until this write is done.
 */
async function lockRunning(tx: Queryable, runId: RunId) {
  const [run] = await tx
    .select({ profileId: runs.profileId, status: runs.status })
    .from(runs)
    .where(eq(runs.id, runId))
    .for('update')
  if (!run) throw new Error('run not found')
  return run.status === 'running' ? run : null
}

const toRecord = (row: typeof runs.$inferSelect): RunRecord => ({
  id: row.id,
  profileId: row.profileId,
  threadId: row.threadId,
  status: row.status,
  budget: row.budget,
  usage: row.usage,
  activeMs: row.activeMs,
  startedAt: row.startedAt,
})

/** Drizzle implementation of the run engine's persistence port (see `RunStore` in core). */
export interface RunStoreOptions {
  /**
   * Encrypts the arguments of a parked approval and decrypts them for the replay. Every
   * production store gets it; without it parking an approval throws and an approved call is
   * treated as unreadable (refused).
   */
  secretBox?: SecretBox
}

export function createRunStore(db: ProvidersDb, { secretBox }: RunStoreOptions = {}): RunStore {
  return {
    async load(runId: RunId): Promise<RunContext | null> {
      const [row] = await db
        .select({
          run: runs,
          personaMd: profiles.personaMd,
          modelMain: profiles.modelMain,
        })
        .from(runs)
        .innerJoin(profiles, eq(profiles.id, runs.profileId))
        .where(eq(runs.id, runId))
      if (!row) return null
      return {
        run: toRecord(row.run),
        profile: { id: row.run.profileId, personaMd: row.personaMd, modelMain: row.modelMain },
      }
    },

    async status(runId): Promise<RunStatus | null> {
      const [row] = await db.select({ status: runs.status }).from(runs).where(eq(runs.id, runId))
      return row?.status ?? null
    },

    async history(run): Promise<ModelMessage[]> {
      if (run.threadId === null) return []
      const rows = await db
        .select({ role: messages.role, parts: messages.parts })
        .from(messages)
        .where(
          and(eq(messages.threadId, run.threadId), inArray(messages.role, ['user', 'assistant'])),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(HISTORY_LIMIT)
      const out: ModelMessage[] = []
      for (const row of rows.reverse()) {
        const text = row.parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
        if (text === '') continue
        out.push({ role: row.role === 'user' ? 'user' : 'assistant', content: text })
      }
      return out
    },

    async steps(runId): Promise<PersistedStep[]> {
      const rows = await db
        .select()
        .from(runSteps)
        .where(eq(runSteps.runId, runId))
        .orderBy(asc(runSteps.idx))
      return rows.map((row) => ({
        idx: row.idx,
        kind: row.kind,
        // reason: the loose objects are AI SDK response messages that this server wrote itself.
        messages: StepInput.parse(row.input).messages as unknown as ModelMessage[],
        usage: row.usage,
      }))
    },

    async transition(runId, from, to, patch: TransitionPatch = {}): Promise<boolean> {
      if (!canTransition(from, to)) throw new Error(`Illegal run transition ${from} -> ${to}`)
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(runs)
          .set({
            status: to,
            ...(patch.startedAt ? { startedAt: patch.startedAt } : {}),
            ...(patch.endedAt ? { endedAt: patch.endedAt } : {}),
            ...(patch.error ? { error: patch.error } : {}),
            ...(patch.usage ? { usage: patch.usage } : {}),
            ...(patch.activeMsDelta
              ? { activeMs: sql`${runs.activeMs} + ${patch.activeMsDelta}` }
              : {}),
          })
          .where(and(eq(runs.id, runId), eq(runs.status, from)))
          .returning({ profileId: runs.profileId })
        if (!row) return false
        // Leaving waiting_approval this way is a cancel: its approval can never be decided now.
        if (from === 'waiting_approval') {
          await cancelPendingApprovals(tx, { id: runId, profileId: row.profileId })
        }
        await recordEvent(tx, {
          profileId: row.profileId,
          runId,
          type: 'run.status',
          payload: { status: to, prevStatus: from, ...(patch.error ? { error: patch.error } : {}) },
        })
        return true
      })
    },

    async appendStep(runId, step: NewStep, runUsage: Usage): Promise<AppendResult> {
      return db.transaction(async (tx) => {
        const run = await lockRunning(tx, runId)
        if (!run) return 'not_running' as const
        const modelId = await insertRunStep(tx, {
          runId,
          idx: step.idx,
          kind: 'model',
          input: asJson({ messages: step.assistantMessages }),
          usage: step.usage,
        })
        // Another execution wrote this step first: nothing of ours exists yet.
        if (modelId === null) return 'duplicate' as const
        await recordEvent(tx, {
          profileId: run.profileId,
          runId,
          type: 'run.step',
          payload: { stepId: modelId, idx: step.idx, kind: 'model', usage: step.usage },
        })
        await tx
          .update(runs)
          .set({ usage: runUsage, activeMs: sql`${runs.activeMs} + ${step.activeMsDelta}` })
          .where(eq(runs.id, runId))
        return 'written' as const
      })
    },

    async appendToolStep(runId, step: NewToolStep): Promise<AppendResult> {
      return db.transaction(async (tx) => {
        const run = await lockRunning(tx, runId)
        if (!run) return 'not_running' as const
        const toolId = await insertRunStep(tx, {
          runId,
          idx: step.idx,
          kind: 'tool',
          input: asJson({ messages: step.toolMessages }),
          usage: null,
        })
        if (toolId === null) return 'duplicate' as const
        await recordEvent(tx, {
          profileId: run.profileId,
          runId,
          type: 'run.step',
          payload: { stepId: toolId, idx: step.idx, kind: 'tool' },
        })
        await tx
          .update(runs)
          .set({ activeMs: sql`${runs.activeMs} + ${step.activeMsDelta}` })
          .where(eq(runs.id, runId))
        return 'written' as const
      })
    },

    async park(runId, wait: RunWait, activeMsDelta): Promise<boolean> {
      const status = wait.kind === 'approval' ? 'waiting_approval' : 'waiting_user'
      // Encrypted before the transaction: the blob is bound to the approval's own id (AAD).
      const approvalId = newId('approval')
      let argsEnc: Uint8Array | undefined
      if (wait.kind === 'approval') {
        if (!secretBox) throw new Error('parking an approval needs the secret box')
        argsEnc = secretBox.encrypt(wait.approval.argsText, approvalAad(approvalId))
      }
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(runs)
          .set({
            status,
            ...(activeMsDelta ? { activeMs: sql`${runs.activeMs} + ${activeMsDelta}` } : {}),
          })
          .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
          .returning({ profileId: runs.profileId })
        if (!row) return false
        let created: ApprovalPublicRow | undefined
        if (wait.kind === 'approval' && argsEnc) {
          const a = wait.approval
          ;[created] = await tx
            .insert(approvals)
            .values({
              id: approvalId,
              profileId: row.profileId,
              runId,
              stepIdx: wait.stepIdx,
              toolCallId: wait.toolCallId,
              tool: a.tool,
              actionClass: a.actionClass,
              argsEnc,
              argsHash: a.argsHash,
              argsRedacted: jsonValue(a.argsRedacted),
              reason: a.reason,
              expiresAt: sql`now() + make_interval(secs => ${APPROVAL_TTL_MS / 1000})`,
            })
            .returning(approvalPublicColumns)
        }
        await tx.insert(runWaits).values({
          runId,
          stepIdx: wait.stepIdx,
          toolCallId: wait.toolCallId,
          kind: wait.kind,
          payload: jsonValue(
            wait.kind === 'approval' && isRecord(wait.payload)
              ? { ...wait.payload, approvalId }
              : wait.payload,
          ),
        })
        await recordEvent(tx, {
          profileId: row.profileId,
          runId,
          type: 'run.status',
          payload: { status, prevStatus: 'running' },
        })
        if (created) {
          await recordEvent(tx, {
            profileId: row.profileId,
            runId,
            type: 'approval.created',
            payload: { approval: toApproval(created) },
          })
        }
        return true
      })
    },

    async toolResult(runId, key: ToolCallKey): Promise<ToolResultRecord | null> {
      const [row] = await db
        .select()
        .from(toolResults)
        .where(
          and(
            eq(toolResults.runId, runId),
            eq(toolResults.stepIdx, key.stepIdx),
            eq(toolResults.toolCallId, key.toolCallId),
          ),
        )
      return row ? toToolRecord(row) : null
    },

    async approvedCall(runId, key: ToolCallKey): Promise<ApprovedCall | null> {
      const [row] = await db
        .select({
          id: approvals.id,
          tool: approvals.tool,
          argsEnc: approvals.argsEnc,
          argsHash: approvals.argsHash,
        })
        .from(approvals)
        .where(
          and(
            eq(approvals.runId, runId),
            eq(approvals.stepIdx, key.stepIdx),
            eq(approvals.toolCallId, key.toolCallId),
            eq(approvals.status, 'approved'),
          ),
        )
      if (!row) return null
      if (!secretBox) return { status: 'unreadable' }
      try {
        const argsText = secretBox.decrypt(row.argsEnc, approvalAad(row.id))
        return { status: 'approved', tool: row.tool, argsText, argsHash: row.argsHash }
      } catch {
        // A changed master key or a tampered blob: the registry refuses the call (fail closed).
        return { status: 'unreadable' }
      }
    },

    async recordToolCall(runId, call): Promise<void> {
      const [run] = await db
        .select({ profileId: runs.profileId })
        .from(runs)
        .where(eq(runs.id, runId))
      if (!run) throw new Error('run not found')
      await recordEvent(db, {
        profileId: run.profileId,
        runId,
        type: 'run.tool_call',
        payload: { ...call },
      })
    },

    async recordToolResult(runId, key, record, emit): Promise<ToolResultRecord> {
      return db.transaction((tx) => insertToolResult(tx, runId, key, record, emit))
    },

    async succeed(runId, result): Promise<boolean> {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(runs)
          .set({
            status: 'succeeded',
            endedAt: result.endedAt,
            usage: result.usage,
            activeMs: sql`${runs.activeMs} + ${result.activeMsDelta}`,
          })
          .where(and(eq(runs.id, runId), eq(runs.status, 'running')))
          .returning({ profileId: runs.profileId, threadId: runs.threadId })
        if (!row) return false
        if (row.threadId !== null) {
          await tx.insert(messages).values({
            id: newId('message'),
            threadId: row.threadId,
            runId,
            role: 'assistant',
            parts: result.text === '' ? [] : [{ type: 'text', text: result.text }],
            tokenCount: result.usage.outputTokens,
          })
          await tx
            .update(threads)
            .set({ lastEventAt: sql`now()` })
            .where(eq(threads.id, row.threadId))
        }
        await recordEvent(tx, {
          profileId: row.profileId,
          runId,
          type: 'run.status',
          payload: { status: 'succeeded', prevStatus: 'running' },
        })
        return true
      })
    },
  }
}
