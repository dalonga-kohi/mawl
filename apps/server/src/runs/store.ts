import {
  canTransition,
  type Json,
  newId,
  type RunId,
  type RunStatus,
  type Usage,
} from '@mawl/contracts'
import type {
  AppendResult,
  ModelMessage,
  NewStep,
  PersistedStep,
  RunContext,
  RunRecord,
  RunStore,
  TransitionPatch,
} from '@mawl/core'
import { schema } from '@mawl/db'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { ProvidersDb } from '../providers/types.ts'
import { insertRunStep, recordEvent } from './repo.ts'

const { runs, profiles, messages, threads, runSteps } = schema

/** Most recent messages sent to the model. A stopgap until context assembly (P3.5). */
export const HISTORY_LIMIT = 200

/** What `appendStep` stores in `run_steps.input_json`. Only assistant and tool messages. */
const StepInput = z.object({
  messages: z.array(z.looseObject({ role: z.enum(['assistant', 'tool']) })),
})

/** Round-trips through JSON so the value is plain JSON (no undefined), as jsonb stores it. */
function asJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

/** Thrown inside a transaction to roll it back when the second row of a step collides. */
class DuplicateStep extends Error {}

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
export function createRunStore(db: ProvidersDb): RunStore {
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
      try {
        return await db.transaction(async (tx) => {
          // Lock the run row: a cancel or pause that commits first is seen here, and one that
          // arrives later waits until this step is written.
          const [run] = await tx
            .select({ profileId: runs.profileId, status: runs.status })
            .from(runs)
            .where(eq(runs.id, runId))
            .for('update')
          if (!run) throw new Error('run not found')
          if (run.status !== 'running') return 'not_running' as const

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

          if (step.toolMessages) {
            const toolId = await insertRunStep(tx, {
              runId,
              idx: step.idx + 1,
              kind: 'tool',
              input: asJson({ messages: step.toolMessages }),
              usage: null,
            })
            if (toolId === null) throw new DuplicateStep()
            await recordEvent(tx, {
              profileId: run.profileId,
              runId,
              type: 'run.step',
              payload: { stepId: toolId, idx: step.idx + 1, kind: 'tool' },
            })
          }
          await tx
            .update(runs)
            .set({ usage: runUsage, activeMs: sql`${runs.activeMs} + ${step.activeMsDelta}` })
            .where(eq(runs.id, runId))
          return 'written' as const
        })
      } catch (err) {
        if (err instanceof DuplicateStep) return 'duplicate'
        throw err
      }
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
