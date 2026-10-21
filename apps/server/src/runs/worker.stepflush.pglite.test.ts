import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import type { RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DeltaSink } from '../events/deltas.ts'
import { createLogger } from '../logger.ts'
import { RunRegistry } from './registry.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'
import { createRunTask } from './worker.ts'

describe('run.execute task: step-end flush (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  }, 120_000)
  afterAll(() => client.close())

  it('flushes at the step end, before the job-end flush, so a stored step never overtakes its text', async () => {
    const profileId = await seedProfile(db)
    const threadId = await seedThread(db, profileId)
    const runId: RunId = await seedRun(db, profileId, { threadId })
    await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'go' }], undefined, runId)

    const log: string[] = []
    const deltas: DeltaSink = {
      add: () => void log.push('add'),
      flush: () => void log.push('flush'),
    }
    const run = createRunTask({
      db,
      registry: new RunRegistry(),
      logger: createLogger({ level: 'silent' }),
      resolveModel: async () => ({ model: fakeModel([{ text: 'hello there' }], { chunkSize: 5 }) }),
      requeue: async () => {},
      deltas,
    })
    await run({ runId }, { abortSignal: new AbortController().signal })

    const row = (await db.select().from(schema.runs).where(eq(schema.runs.id, runId)))[0]
    expect(row?.status).toBe('succeeded')
    const lastAdd = log.lastIndexOf('add')
    const flushesAfterText = log.slice(lastAdd + 1).filter((e) => e === 'flush')
    // One flush for the step end and one for the job end.
    expect(flushesAfterText).toHaveLength(2)
  })
})
