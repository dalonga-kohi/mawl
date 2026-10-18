import {
  type Message,
  type MessageId,
  newId,
  type ProfileId,
  RUN_TERMINAL_STATUSES,
  type Run,
  type RunBudget,
  type RunId,
  type RunStatus,
  type Thread,
  type ThreadId,
} from '@faire/contracts'
import type { RunStore } from '@faire/core'
import { schema } from '@faire/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import { EntityNotFoundError, RunConflictError } from './errors.ts'
import type { RunRegistry } from './registry.ts'
import { recordEvent } from './repo.ts'
import { createRunStore } from './store.ts'

const { runs, threads, messages, profiles } = schema

const DEFAULT_MESSAGE_LIMIT = 50
const TITLE_CHARS = 60
/** Compare-and-set attempts before a cancel gives up; each retry follows a concurrent change. */
const CAS_ATTEMPTS = 3

export interface StartRunInput {
  profileId: ProfileId
  threadId?: ThreadId | undefined
  prompt: string
  budget?: RunBudget | undefined
}

export interface RunServiceDeps {
  db: ProvidersDb
  registry: RunRegistry
  /** Hands a run to the job queue. Failures are logged: the run stays queued and boot recovery picks it up. */
  enqueue(runId: RunId): Promise<void>
  logger: Logger
}

export interface RunService {
  start(input: StartRunInput): Promise<Run>
  get(id: RunId): Promise<Run>
  cancel(id: RunId): Promise<Run>
  pause(id: RunId): Promise<Run>
  resume(id: RunId): Promise<Run>
  listThreads(profileId: ProfileId): Promise<Thread[]>
  threadMessages(input: {
    threadId: ThreadId
    limit?: number | undefined
    before?: MessageId | undefined
  }): Promise<Message[]>
}

const toRun = (row: typeof runs.$inferSelect): Run => ({
  id: row.id,
  profileId: row.profileId,
  threadId: row.threadId,
  trigger: row.trigger,
  status: row.status,
  budget: row.budget,
  usage: row.usage,
  segmentNo: row.segmentNo,
  activeMs: row.activeMs,
  startedAt: row.startedAt?.toISOString() ?? null,
  endedAt: row.endedAt?.toISOString() ?? null,
  error: row.error,
})

const toThread = (row: typeof threads.$inferSelect): Thread => ({
  id: row.id,
  profileId: row.profileId,
  channel: row.channel,
  peer: row.peer,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
  lastEventAt: row.lastEventAt?.toISOString() ?? null,
})

const toMessage = (row: typeof messages.$inferSelect): Message => ({
  id: row.id,
  threadId: row.threadId,
  runId: row.runId,
  role: row.role,
  parts: row.parts,
  tokenCount: row.tokenCount,
  createdAt: row.createdAt.toISOString(),
})

const isTerminal = (status: RunStatus): boolean =>
  (RUN_TERMINAL_STATUSES as readonly RunStatus[]).includes(status)

/** First 60 characters, whitespace collapsed. Null when nothing is left. */
function titleOf(prompt: string): string | null {
  const title = Array.from(prompt.replace(/\s+/g, ' ').trim()).slice(0, TITLE_CHARS).join('')
  return title === '' ? null : title
}

export function createRunService({ db, registry, enqueue, logger }: RunServiceDeps): RunService {
  const store: RunStore = createRunStore(db)

  async function load(id: RunId): Promise<Run> {
    const [row] = await db.select().from(runs).where(eq(runs.id, id))
    if (!row) throw new EntityNotFoundError('run', id)
    return toRun(row)
  }

  async function enqueueQuietly(runId: RunId): Promise<void> {
    try {
      await enqueue(runId)
    } catch (err) {
      // Name only. The run is durable and queued; boot recovery re-enqueues it.
      logger.error(
        { runId, errName: err instanceof Error ? err.name : 'unknown' },
        'could not enqueue run',
      )
    }
  }

  async function statusOrThrow(id: RunId): Promise<RunStatus> {
    const status = await store.status(id)
    if (status === null) throw new EntityNotFoundError('run', id)
    return status
  }

  return {
    async start(input) {
      const runId = newId('run')
      await db.transaction(async (tx) => {
        const [profile] = await tx
          .select({ id: profiles.id })
          .from(profiles)
          .where(eq(profiles.id, input.profileId))
        if (!profile) throw new EntityNotFoundError('profile', input.profileId)

        let threadId = input.threadId
        if (threadId === undefined) {
          threadId = newId('thread')
          await tx.insert(threads).values({
            id: threadId,
            profileId: input.profileId,
            channel: 'app',
            title: titleOf(input.prompt),
            lastEventAt: sql`now()`,
          })
        } else {
          const [thread] = await tx
            .select({ profileId: threads.profileId })
            .from(threads)
            .where(eq(threads.id, threadId))
          if (!thread || thread.profileId !== input.profileId) {
            throw new EntityNotFoundError('thread', threadId)
          }
        }

        await tx.insert(runs).values({
          id: runId,
          profileId: input.profileId,
          threadId,
          trigger: 'user',
          budget: input.budget ?? {},
        })
        await tx.insert(messages).values({
          id: newId('message'),
          threadId,
          runId,
          role: 'user',
          parts: [{ type: 'text', text: input.prompt }],
        })
        await tx.update(threads).set({ lastEventAt: sql`now()` }).where(eq(threads.id, threadId))
        await recordEvent(tx, {
          profileId: input.profileId,
          runId,
          type: 'run.status',
          payload: { status: 'queued' },
        })
      })
      await enqueueQuietly(runId)
      return load(runId)
    },

    get: load,

    async cancel(id) {
      let status = await statusOrThrow(id)
      for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt++) {
        if (isTerminal(status)) throw new RunConflictError(status, 'cancelled')
        if (await store.transition(id, status, 'cancelled', { endedAt: new Date() })) {
          registry.abort(id, 'cancel')
          return load(id)
        }
        status = await statusOrThrow(id)
      }
      throw new RunConflictError(status, 'cancelled')
    },

    async pause(id) {
      const status = await statusOrThrow(id)
      if (status !== 'running') throw new RunConflictError(status, 'paused')
      if (!(await store.transition(id, 'running', 'paused'))) {
        throw new RunConflictError(await statusOrThrow(id), 'paused')
      }
      registry.abort(id, 'pause')
      return load(id)
    },

    async resume(id) {
      const status = await statusOrThrow(id)
      if (status !== 'paused') throw new RunConflictError(status, 'queued')
      if (!(await store.transition(id, 'paused', 'queued'))) {
        throw new RunConflictError(await statusOrThrow(id), 'queued')
      }
      await enqueueQuietly(id)
      return load(id)
    },

    async listThreads(profileId) {
      const [profile] = await db
        .select({ id: profiles.id })
        .from(profiles)
        .where(eq(profiles.id, profileId))
      if (!profile) throw new EntityNotFoundError('profile', profileId)
      const rows = await db
        .select()
        .from(threads)
        .where(eq(threads.profileId, profileId))
        .orderBy(
          sql`${threads.lastEventAt} desc nulls last`,
          desc(threads.createdAt),
          desc(threads.id),
        )
      return rows.map(toThread)
    },

    async threadMessages({ threadId, limit, before }) {
      const [thread] = await db
        .select({ id: threads.id })
        .from(threads)
        .where(eq(threads.id, threadId))
      if (!thread) throw new EntityNotFoundError('thread', threadId)
      if (before !== undefined) {
        const [cursor] = await db
          .select({ id: messages.id })
          .from(messages)
          .where(and(eq(messages.id, before), eq(messages.threadId, threadId)))
        if (!cursor) throw new EntityNotFoundError('message', before)
      }
      // Keyset paging on (created_at, id). The cursor's own timestamp is read inside the query, so
      // its microseconds are never rounded through a JS Date, and ties on created_at cannot drop rows.
      const rows = await db
        .select()
        .from(messages)
        .where(
          and(
            eq(messages.threadId, threadId),
            before === undefined
              ? undefined
              : sql`(${messages.createdAt}, ${messages.id}) < (select m.created_at, m.id from messages m where m.id = ${before})`,
          ),
        )
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit ?? DEFAULT_MESSAGE_LIMIT)
      return rows.reverse().map(toMessage)
    },
  }
}
