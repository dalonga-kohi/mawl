import { RunId } from '@faire/contracts'
import {
  ABORT_SHUTDOWN,
  type Clock,
  executeRun,
  type ProfileRecord,
  type ResolvedModel,
  type RunRecord,
} from '@faire/core'
import { type DbHandle, schema } from '@faire/db'
import { inArray } from 'drizzle-orm'
import { Logger as GraphileLogger, type LogLevel, run, runMigrations } from 'graphile-worker'
import { z } from 'zod'
import type { DeltaSink } from '../events/deltas.ts'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { RunRegistry } from './registry.ts'
import { createRunStore } from './store.ts'

const { runs } = schema

export const RUN_TASK = 'run.execute'
const JOB_MAX_ATTEMPTS = 5
const CONCURRENCY = 4
/** A job that finds its run still unwinding in this process tries again this long after. */
const REQUEUE_DELAY_MS = 1000
/** Bound on those retries (about 30 s); after that boot recovery is the safety net. */
export const MAX_REQUEUES = 30

/** `retry` counts how often this job was re-queued because the previous execution was still unwinding. */
const Payload = z.strictObject({ runId: RunId, retry: z.number().int().nonnegative().optional() })

export interface RunTaskDeps {
  db: ProvidersDb
  logger: Logger
  registry: RunRegistry
  resolveModel(run: RunRecord, profile: ProfileRecord): Promise<ResolvedModel>
  clock?: Clock
  /** Queues the job again for later (see MAX_REQUEUES). */
  requeue(runId: RunId, retry: number): Promise<void>
  /** Receives the model's text tokens. Flushed when each step ends and when the job ends, however it ends. */
  deltas?: DeltaSink
}

/** The `run.execute` job handler. Throws only on infrastructure errors, so Graphile retries those. */
export function createRunTask(deps: RunTaskDeps) {
  const { logger, registry } = deps
  const clock = deps.clock ?? { now: () => new Date() }
  const store = createRunStore(deps.db)

  return async (payload: unknown, helpers: { abortSignal: AbortSignal }): Promise<void> => {
    const parsed = Payload.safeParse(payload)
    if (!parsed.success) {
      // A malformed job can never succeed: log and drop it instead of retrying it.
      logger.error({ task: RUN_TASK }, 'run job has an invalid payload')
      return
    }
    const { runId, retry = 0 } = parsed.data
    const controller = registry.register(runId)
    if (!controller) {
      // The previous execution is still winding down (pause, then a quick resume). Dropping this
      // job would strand the run in `queued`, so ask for another one a moment later.
      if (retry >= MAX_REQUEUES) {
        logger.warn(
          { runId },
          'run still unwinding after the requeue limit; boot recovery will pick it up',
        )
        return
      }
      logger.debug({ runId, retry }, 'run is still unwinding in this process, requeueing')
      await deps.requeue(runId, retry + 1)
      return
    }
    const onAbort = () => controller.abort(ABORT_SHUTDOWN)
    helpers.abortSignal.addEventListener('abort', onAbort, { once: true })
    // The abort may have fired before the listener existed.
    if (helpers.abortSignal.aborted) onAbort()
    try {
      // The run's profile routes its deltas; one lookup per job, only when someone listens.
      const profileId = deps.deltas ? (await store.load(runId))?.run.profileId : undefined
      const sink = deps.deltas
      const result = await executeRun({
        runId,
        store,
        clock,
        signal: controller.signal,
        resolveModel: deps.resolveModel,
        ...(sink && profileId
          ? {
              onDelta: ({ runId: id, stepIdx, text }) =>
                sink.add({ profileId, runId: id, stepIdx, text }),
              onStepEnd: ({ runId: id }) => sink.flush(id),
            }
          : {}),
        onFailure: ({ code, errName }) => logger.warn({ runId, code, errName }, 'run failed'),
      })
      logger.info({ runId, outcome: result.outcome }, 'run job finished')
    } finally {
      deps.deltas?.flush(runId)
      helpers.abortSignal.removeEventListener('abort', onAbort)
      registry.release(runId, controller)
    }
  }
}

export interface RunWorkerDeps {
  pool: DbHandle['pool']
  db: ProvidersDb
  logger: Logger
  registry: RunRegistry
  resolveModel(run: RunRecord, profile: ProfileRecord): Promise<ResolvedModel>
  clock?: Clock
  concurrency?: number
  /** Delay before a requeued job runs again. Tests shorten it. */
  requeueDelayMs?: number
  deltas?: DeltaSink
}

export interface RunWorker {
  /** Queues a `run.execute` job. */
  enqueue(runId: RunId): Promise<void>
  /** Queues a job for every run left `queued` or `running` (boot recovery). Returns how many. */
  recover(): Promise<number>
  /** Lets running jobs finish (call after aborting them) and stops polling for new ones. */
  stop(): Promise<void>
}

/** Routes Graphile Worker's logs into pino. */
function graphileLogger(logger: Logger): GraphileLogger {
  const method = { error: 'error', warning: 'warn', info: 'debug', debug: 'debug' } as const
  return new GraphileLogger((scope) => (level: LogLevel, message: string) => {
    logger[method[level]]({ graphile: scope }, message)
  })
}

/**
 * Starts the Graphile Worker that executes runs. It shares the server's pg pool. Waiting states
 * end the job and a new job continues the run, so a job never outlives one execution.
 */
export async function startRunWorker(deps: RunWorkerDeps): Promise<RunWorker> {
  const { pool, db, logger, registry } = deps
  const log = graphileLogger(logger)

  await runMigrations({ pgPool: pool, logger: log })

  // Assigned right after `run()` returns; the task only runs after that.
  let addJob: (payload: { runId: RunId; retry?: number }, runAt?: Date) => Promise<void> =
    async () => {
      throw new Error('run worker is not started')
    }

  const runner = await run({
    pgPool: pool,
    logger: log,
    concurrency: deps.concurrency ?? CONCURRENCY,
    noHandleSignals: true,
    taskList: {
      [RUN_TASK]: createRunTask({
        db,
        logger,
        registry,
        resolveModel: deps.resolveModel,
        ...(deps.clock ? { clock: deps.clock } : {}),
        ...(deps.deltas ? { deltas: deps.deltas } : {}),
        requeue: (runId, retry) =>
          addJob(
            { runId, retry },
            new Date(Date.now() + (deps.requeueDelayMs ?? REQUEUE_DELAY_MS)),
          ),
      }),
    },
  })
  addJob = async (payload, runAt) => {
    await runner.addJob(RUN_TASK, payload, {
      maxAttempts: JOB_MAX_ATTEMPTS,
      ...(runAt ? { runAt } : {}),
    })
  }

  const enqueue = (runId: RunId) => addJob({ runId })

  return {
    enqueue,
    async recover() {
      const rows = await db
        .select({ id: runs.id })
        .from(runs)
        .where(inArray(runs.status, ['queued', 'running']))
      for (const row of rows) await enqueue(row.id)
      return rows.length
    },
    stop: () => runner.stop(),
  }
}
