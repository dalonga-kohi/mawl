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
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { RunRegistry } from './registry.ts'
import { createRunStore } from './store.ts'

const { runs } = schema

export const RUN_TASK = 'run.execute'
const JOB_MAX_ATTEMPTS = 5
const CONCURRENCY = 4

const Payload = z.strictObject({ runId: RunId })

export interface RunWorkerDeps {
  pool: DbHandle['pool']
  db: ProvidersDb
  logger: Logger
  registry: RunRegistry
  resolveModel(run: RunRecord, profile: ProfileRecord): Promise<ResolvedModel>
  clock?: Clock
  concurrency?: number
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
  const clock = deps.clock ?? { now: () => new Date() }
  const store = createRunStore(db)
  const log = graphileLogger(logger)

  await runMigrations({ pgPool: pool, logger: log })

  const runner = await run({
    pgPool: pool,
    logger: log,
    concurrency: deps.concurrency ?? CONCURRENCY,
    noHandleSignals: true,
    taskList: {
      [RUN_TASK]: async (payload, helpers) => {
        const parsed = Payload.safeParse(payload)
        if (!parsed.success) {
          // A malformed job can never succeed: log and drop it instead of retrying it.
          logger.error({ task: RUN_TASK }, 'run job has an invalid payload')
          return
        }
        const { runId } = parsed.data
        const controller = registry.register(runId)
        if (!controller) {
          logger.debug({ runId }, 'run is already executing in this process')
          return
        }
        const onAbort = () => controller.abort(ABORT_SHUTDOWN)
        helpers.abortSignal.addEventListener('abort', onAbort, { once: true })
        try {
          const result = await executeRun({
            runId,
            store,
            clock,
            signal: controller.signal,
            resolveModel: deps.resolveModel,
            onFailure: ({ code, errName }) => logger.warn({ runId, code, errName }, 'run failed'),
          })
          logger.info({ runId, outcome: result.outcome }, 'run job finished')
        } finally {
          helpers.abortSignal.removeEventListener('abort', onAbort)
          registry.release(runId, controller)
        }
      },
    },
  })

  const enqueue = async (runId: RunId) => {
    await runner.addJob(RUN_TASK, { runId }, { maxAttempts: JOB_MAX_ATTEMPTS })
  }

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
