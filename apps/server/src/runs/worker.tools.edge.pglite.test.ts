import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import type { RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createServerTools } from '../tools/registry.ts'
import { RunRegistry } from './registry.ts'
import { createRunService } from './service.ts'
import { createRunStore } from './store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'
import { createRunTask } from './worker.ts'

const { runs, events, runWaits } = schema

describe('built-in tools: hostile data through the real store (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const logger = createLogger({ level: 'silent' })

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

  function task(model: ReturnType<typeof fakeModel>, pageText = 'page') {
    const registry = new RunRegistry()
    const webFetch = vi.fn(
      async () => new Response(pageText, { headers: { 'content-type': 'text/plain' } }),
    )
    const run = createRunTask({
      db,
      registry,
      logger,
      resolveModel: async () => ({ model }),
      requeue: async () => {},
      tools: createServerTools({ db, search: { provider: async () => null }, webFetch }),
    })
    return {
      run: (runId: RunId) => run({ runId }, { abortSignal: new AbortController().signal }),
      registry,
    }
  }

  const statusOf = async (id: RunId) =>
    (await db.select().from(runs).where(eq(runs.id, id)))[0]?.status
  const eventTypes = async (id: RunId) =>
    (await db.select().from(events).where(eq(events.runId, id)).orderBy(asc(events.id))).map(
      (e) => e.type,
    )

  const fetchCall = [{ name: 'web_fetch', input: { url: 'https://example.com/' } }]

  it('a page with a NUL byte does not fail the run or loop the job (Postgres rejects \\u0000 in text and jsonb)', async () => {
    const runId = await seedQueued()
    const t = task(fakeModel([{ toolCalls: fetchCall }, { text: 'done' }]), 'before\u0000after')
    await t.run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
  })

  it('a large page with a NUL byte still becomes an artifact', async () => {
    const runId = await seedQueued()
    const page = `${'x'.repeat(10_000)}\u0000${'y'.repeat(10_000)}`
    const t = task(fakeModel([{ toolCalls: fetchCall }, { text: 'done' }]), page)
    await t.run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
  })

  it('a page whose 300th character splits an emoji does not break the event payload', async () => {
    const runId = await seedQueued()
    const page = `${'a'.repeat(299 - 'Source: https://example.com/\n\n'.length)}\u{1F600}${'b'.repeat(500)}`
    const t = task(fakeModel([{ toolCalls: fetchCall }, { text: 'done' }]), page)
    await t.run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
  })

  // Behavior changed in fix round 1 (reviewer B2): calls after a park stay unrun, so the second
  // question is asked after the first is answered instead of getting a typed error.
  it('two ask_user calls in one step park on the first, then on the second after the first reply', async () => {
    const runId = await seedQueued()
    const t = task(
      fakeModel([
        {
          toolCalls: [
            { name: 'ask_user', input: { question: 'first?' } },
            { name: 'ask_user', input: { question: 'second?' } },
          ],
        },
      ]),
    )
    await t.run(runId)
    expect(await statusOf(runId)).toBe('waiting_user')
    const waits = await db.select().from(runWaits).where(eq(runWaits.runId, runId))
    expect(waits).toHaveLength(1)
    expect(JSON.stringify(waits[0]?.payload)).toContain('first?')
    const store = createRunStore(db)
    expect(await store.toolResult(runId, { stepIdx: 0, toolCallId: 'call_2' })).toBeNull()
    const service = createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async () => {},
    })
    await service.reply(runId, 'one')
    const unused = fakeModel([{ text: 'unused' }])
    await task(unused).run(runId)
    expect(await statusOf(runId)).toBe('waiting_user')
    expect(unused.calls).toHaveLength(0)
    const open = await db.select().from(runWaits).where(eq(runWaits.runId, runId))
    expect(open.map((w) => [w.toolCallId, w.resolvedAt === null])).toEqual(
      expect.arrayContaining([
        ['call_1', false],
        ['call_2', true],
      ]),
    )
    await service.reply(runId, 'two')
    await task(fakeModel([{ text: 'both answered' }])).run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
  })

  it('a notify before the ask_user in the same step does not fire again after the reply', async () => {
    const runId = await seedQueued()
    await task(
      fakeModel([
        {
          toolCalls: [
            { name: 'notify', input: { title: 'hi', body: 'b' } },
            { name: 'ask_user', input: { question: 'ok?' } },
          ],
        },
      ]),
    ).run(runId)
    expect(await statusOf(runId)).toBe('waiting_user')
    await createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async () => {},
    }).reply(runId, 'yes')
    await task(fakeModel([{ text: 'fin' }])).run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
    expect((await eventTypes(runId)).filter((x) => x === 'notify')).toHaveLength(1)
  })

  it('a reply that races a cancel leaves a consistent run and never throws a raw error', async () => {
    const runId = await seedQueued()
    await task(fakeModel([{ toolCalls: [{ name: 'ask_user', input: { question: 'q?' } }] }])).run(
      runId,
    )
    const enqueued: RunId[] = []
    const service = createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async (id) => void enqueued.push(id),
    })
    const results = await Promise.allSettled([service.reply(runId, 'a'), service.cancel(runId)])
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason?.name).toBe('RunConflictError')
    }
    const status = await statusOf(runId)
    // Cancel always wins eventually (it retries after a reply moved the run to running).
    expect(status).toBe('cancelled')
  })

  it('a reply with a NUL character is refused or sanitised, and the run stays answerable', async () => {
    const runId = await seedQueued()
    await task(fakeModel([{ toolCalls: [{ name: 'ask_user', input: { question: 'q?' } }] }])).run(
      runId,
    )
    const service = createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async () => {},
    })
    await service.reply(runId, 'a\u0000b').catch(() => {})
    const status = await statusOf(runId)
    if (status === 'waiting_user') {
      // Refused: the run must still accept a clean answer afterwards.
      await expect(service.reply(runId, 'clean')).resolves.toMatchObject({ status: 'running' })
    } else {
      expect(status).toBe('running')
    }
  })
})
