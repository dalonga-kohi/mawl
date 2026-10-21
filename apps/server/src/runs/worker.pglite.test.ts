import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import type { RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { DeltaSink } from '../events/deltas.ts'
import { createLogger } from '../logger.ts'
import { RunRegistry } from './registry.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'
import { createRunTask, MAX_REQUEUES } from './worker.ts'

const { runs } = schema

describe('run.execute task (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  }, 120_000)
  afterAll(() => client.close())

  async function seedQueued(): Promise<RunId> {
    const profileId = await seedProfile(db)
    const threadId = await seedThread(db, profileId)
    const runId = await seedRun(db, profileId, { threadId })
    await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'go' }], undefined, runId)
    return runId
  }

  function task(
    over: { registry?: RunRegistry; model?: ReturnType<typeof fakeModel>; deltas?: DeltaSink } = {},
  ) {
    const model = over.model ?? fakeModel([{ text: 'done' }])
    const requeue = vi.fn(async (_runId: RunId, _retry: number) => {})
    const registry = over.registry ?? new RunRegistry()
    const run = createRunTask({
      db,
      registry,
      logger: createLogger({ level: 'silent' }),
      resolveModel: async () => ({ model }),
      requeue,
      ...(over.deltas ? { deltas: over.deltas } : {}),
    })
    return { run, requeue, registry, model }
  }

  const status = async (id: RunId) =>
    (await db.select().from(runs).where(eq(runs.id, id)))[0]?.status

  it('executes the run named in the payload', async () => {
    const runId = await seedQueued()
    const t = task()
    await t.run({ runId }, { abortSignal: new AbortController().signal })
    expect(await status(runId)).toBe('succeeded')
    expect(t.registry.size).toBe(0)
  })

  it('hands the model text to the delta sink with the run and profile, and flushes when the job ends', async () => {
    const runId = await seedQueued()
    const [row] = await db.select().from(runs).where(eq(runs.id, runId))
    const added: { profileId: string; runId: string; stepIdx: number; text: string }[] = []
    const flushed: string[] = []
    const deltas: DeltaSink = {
      add: (d) => void added.push(d),
      flush: (id) => void flushed.push(id),
    }
    const t = task({ deltas, model: fakeModel([{ text: 'hello there' }], { chunkSize: 5 }) })
    await t.run({ runId }, { abortSignal: new AbortController().signal })
    expect(added.map((d) => d.text).join('')).toBe('hello there')
    expect(added.every((d) => d.runId === runId && d.profileId === row?.profileId)).toBe(true)
    expect(added.every((d) => d.stepIdx === 0)).toBe(true)
    // Flushed at the step end and again at the job end; a flush with nothing buffered is a no-op.
    expect(new Set(flushed)).toEqual(new Set([runId]))
  })

  it('flushes the sink even when the execution throws', async () => {
    const runId = await seedQueued()
    const flushed: string[] = []
    const deltas: DeltaSink = { add: () => {}, flush: (id) => void flushed.push(id) }
    const t = task({ deltas })
    const run = createRunTask({
      db,
      registry: t.registry,
      logger: createLogger({ level: 'silent' }),
      resolveModel: async () => {
        throw new Error('infrastructure down')
      },
      requeue: async () => {},
      deltas,
    })
    await expect(run({ runId }, { abortSignal: new AbortController().signal })).rejects.toThrow(
      'infrastructure down',
    )
    expect(flushed).toEqual([runId])
  })

  it('stops a run whose shutdown abort fired before the listener was attached', async () => {
    const runId = await seedQueued()
    const t = task()
    const abort = new AbortController()
    abort.abort()
    await t.run({ runId }, { abortSignal: abort.signal })
    expect(t.model.calls).toHaveLength(0)
    // Left running with its steps, so the next boot resumes it; never failed or succeeded.
    expect(await status(runId)).toBe('running')
  })

  it('requeues itself later, with a counter, when the previous execution is still unwinding', async () => {
    const runId = await seedQueued()
    const registry = new RunRegistry()
    registry.register(runId)
    const t = task({ registry })
    await t.run({ runId }, { abortSignal: new AbortController().signal })
    expect(t.requeue).toHaveBeenCalledWith(runId, 1)
    await t.run({ runId, retry: 5 }, { abortSignal: new AbortController().signal })
    expect(t.requeue).toHaveBeenLastCalledWith(runId, 6)
    expect(t.model.calls).toHaveLength(0)
    expect(await status(runId)).toBe('queued')
  })

  it('gives up requeueing after the limit and leaves the run to boot recovery', async () => {
    const runId = await seedQueued()
    const registry = new RunRegistry()
    registry.register(runId)
    const t = task({ registry })
    await t.run({ runId, retry: MAX_REQUEUES }, { abortSignal: new AbortController().signal })
    expect(t.requeue).not.toHaveBeenCalled()
  })

  it('drops a job with a malformed payload instead of retrying it', async () => {
    const t = task()
    await expect(
      t.run({ runId: 'nope' }, { abortSignal: new AbortController().signal }),
    ).resolves.toBeUndefined()
    expect(t.requeue).not.toHaveBeenCalled()
  })

  it('lets infrastructure errors propagate so Graphile retries the job', async () => {
    const runId = await seedQueued()
    const t = task()
    const bad = createRunTask({
      db,
      registry: t.registry,
      logger: createLogger({ level: 'silent' }),
      resolveModel: async () => {
        throw new Error('db down')
      },
      requeue: t.requeue,
    })
    await expect(bad({ runId }, { abortSignal: new AbortController().signal })).rejects.toThrow(
      'db down',
    )
    expect(t.registry.size).toBe(0)
  })
})
