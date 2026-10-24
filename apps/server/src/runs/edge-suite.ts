import { type MessageId, newId, type RunId } from '@mawl/contracts'
import { executeRun } from '@mawl/core'
import { schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { and, asc, count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.ts'
import type { MadeServiceDb } from '../providers/service-suite.ts'
import { RunRegistry } from './registry.ts'
import { createModelResolver as createServerResolver } from './resolve-model.ts'
import { createRunService } from './service.ts'
import { createRunStore } from './store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'

const { runs, runSteps, messages, events } = schema

/** Edge cases the slice suites do not reach: ties, races, ordering, odd input. */
export function describeRunEdges(name: string, make: () => Promise<MadeServiceDb>): void {
  describe(name, () => {
    let made: MadeServiceDb
    // reason: assigned in beforeAll, read only inside tests.
    let db!: MadeServiceDb['db']

    beforeAll(async () => {
      made = await make()
      await made.migrate()
      db = made.db
    }, 120_000)

    afterAll(async () => {
      await made.close()
    })

    const clock = { now: () => new Date() }
    const service = () =>
      createRunService({
        db,
        registry: new RunRegistry(),
        logger: createLogger({ level: 'silent' }),
        enqueue: async () => {},
      })

    async function seedUnfinished(status: 'queued' | 'running') {
      const profileId = await seedProfile(db)
      const threadId = await seedThread(db, profileId)
      const runId = await seedRun(db, profileId, {
        threadId,
        status,
        ...(status === 'running' ? { startedAt: new Date() } : {}),
      })
      await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'go' }], undefined, runId)
      return { profileId, threadId, runId }
    }

    const run = (runId: RunId, text: string) =>
      executeRun({
        runId,
        store: createRunStore(db),
        clock,
        signal: new AbortController().signal,
        resolveModel: async () => ({ model: fakeModel([{ text }]) }),
      })

    describe('duplicate execution of one run', () => {
      it.each(['queued', 'running'] as const)(
        'two concurrent executions of a %s run write one set of steps and one reply',
        async (status) => {
          const { runId, threadId } = await seedUnfinished(status)

          const outcomes = await Promise.all([run(runId, 'from A'), run(runId, 'from B')])

          expect(outcomes.filter((o) => o.outcome === 'succeeded')).toHaveLength(1)
          const steps = await db.select().from(runSteps).where(eq(runSteps.runId, runId))
          expect(steps).toHaveLength(1)
          const replies = await db
            .select()
            .from(messages)
            .where(and(eq(messages.threadId, threadId), eq(messages.role, 'assistant')))
          expect(replies).toHaveLength(1)
          const [row] = await db.select().from(runs).where(eq(runs.id, runId))
          expect(row?.status).toBe('succeeded')
          const [{ n } = { n: 0 }] = await db
            .select({ n: count() })
            .from(events)
            .where(and(eq(events.runId, runId), eq(events.type, 'run.step')))
          expect(n).toBe(1)
        },
      )
    })

    describe('model configuration through the real store', () => {
      it.each([
        ['an unparseable model ref', () => 'not a ref'],
        ['a ref to a credential that does not exist', () => `${newId('credential')}:gpt-x`],
        ['an empty model ref', () => ''],
      ])('fails %s with model_not_configured and no model call', async (_label, ref) => {
        const profileId = await seedProfile(db, { modelMain: ref() })
        const threadId = await seedThread(db, profileId)
        const runId = await seedRun(db, profileId, { threadId })
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'hi' }], undefined, runId)

        const out = await executeRun({
          runId,
          store: createRunStore(db),
          clock,
          signal: new AbortController().signal,
          resolveModel: createServerResolver({
            list: async () => [],
            createModel: async () => {
              throw new Error('must not be called')
            },
          }),
        })

        expect(out).toEqual({ outcome: 'failed', error: 'model_not_configured' })
        const [row] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(row).toMatchObject({ status: 'failed', error: 'model_not_configured' })
        expect(row?.startedAt).not.toBeNull()
        expect(row?.endedAt).not.toBeNull()
      })
    })

    describe('history ordering', () => {
      it('sends earlier runs of the thread, oldest first, then the current prompt', async () => {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        const first = await seedRun(db, profileId, { threadId, status: 'succeeded' })
        const second = await seedRun(db, profileId, { threadId })
        const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s))
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'q1' }], at(1), first)
        await seedMessage(db, threadId, 'assistant', [{ type: 'text', text: 'a1' }], at(2), first)
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'q2' }], at(3), second)

        const rec = (await createRunStore(db).load(second))?.run
        const history = await createRunStore(db).history(rec as never)

        expect(history).toEqual([
          { role: 'user', content: 'q1' },
          { role: 'assistant', content: 'a1' },
          { role: 'user', content: 'q2' },
        ])
      })

      it('keeps unicode and multi-part text intact', async () => {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        const runId = await seedRun(db, profileId, { threadId })
        await seedMessage(
          db,
          threadId,
          'user',
          [
            { type: 'text', text: 'zażółć 🐘 ' },
            { type: 'text', text: '日本語' },
          ],
          undefined,
          runId,
        )
        const rec = (await createRunStore(db).load(runId))?.run
        expect(await createRunStore(db).history(rec as never)).toEqual([
          { role: 'user', content: 'zażółć 🐘 日本語' },
        ])
      })
    })

    describe('start input edges', () => {
      it('titles a thread by code points, never splitting an emoji, and collapses whitespace', async () => {
        const profileId = await seedProfile(db)
        const emoji = await service().start({ profileId, prompt: '🐘'.repeat(100) })
        const multi = await service().start({ profileId, prompt: 'line one\n\n\tline   two' })
        const titleOf = async (threadId: string) =>
          (
            await db
              .select()
              .from(schema.threads)
              .where(eq(schema.threads.id, threadId as never))
          )[0]?.title
        expect(await titleOf(emoji.threadId as string)).toBe('🐘'.repeat(60))
        expect(await titleOf(multi.threadId as string)).toBe('line one line two')
      })

      it('stores a very large prompt unchanged', async () => {
        const profileId = await seedProfile(db)
        const prompt = `${'long '.repeat(40_000)}end`
        const started = await service().start({ profileId, prompt })
        const msgs = await service().threadMessages({ threadId: started.threadId as never })
        expect(msgs[0]?.parts).toEqual([{ type: 'text', text: prompt }])
      })

      it('keeps the budget override exactly as given', async () => {
        const profileId = await seedProfile(db)
        const started = await service().start({
          profileId,
          prompt: 'tiny',
          budget: { maxSteps: 1, maxTokens: 1, maxWallClockMs: 1 },
        })
        expect(started.budget).toEqual({ maxSteps: 1, maxTokens: 1, maxWallClockMs: 1 })
      })
    })

    describe('start atomicity', () => {
      it('writes no thread, message or run when the last write of start fails', async () => {
        const profileId = await seedProfile(db)
        // A db whose transactions fail when the status event is written (the last statement).
        const failing = new Proxy(db, {
          get(target, prop, receiver) {
            if (prop !== 'transaction') return Reflect.get(target, prop, receiver)
            return (cb: (tx: unknown) => Promise<unknown>) =>
              target.transaction((tx) =>
                cb(
                  new Proxy(tx, {
                    get(t, p, r) {
                      if (p !== 'insert') return Reflect.get(t, p, r)
                      return (table: unknown) => {
                        if (table === events) throw new Error('disk full')
                        return t.insert(table as never)
                      }
                    },
                  }),
                ),
              )
          },
        })
        const svc = createRunService({
          db: failing,
          registry: new RunRegistry(),
          logger: createLogger({ level: 'silent' }),
          enqueue: async () => {},
        })

        await expect(svc.start({ profileId, prompt: 'doomed' })).rejects.toThrow('disk full')

        expect(await svc.listThreads(profileId)).toEqual([])
        const rows = await db.select().from(runs).where(eq(runs.profileId, profileId))
        expect(rows).toEqual([])
      })
    })

    describe('state conflicts', () => {
      it.each(['queued', 'succeeded', 'failed', 'cancelled', 'paused'] as const)(
        'pause of a %s run answers CONFLICT with from and to',
        async (status) => {
          const profileId = await seedProfile(db)
          const id = await seedRun(db, profileId, { status })
          await expect(service().pause(id)).rejects.toMatchObject({
            name: 'RunConflictError',
            from: status,
            to: 'paused',
          })
        },
      )

      it.each(['queued', 'running', 'succeeded', 'failed', 'cancelled'] as const)(
        'resume of a %s run answers CONFLICT with from and to',
        async (status) => {
          const profileId = await seedProfile(db)
          const id = await seedRun(db, profileId, { status })
          await expect(service().resume(id)).rejects.toMatchObject({
            name: 'RunConflictError',
            from: status,
            to: 'queued',
          })
        },
      )

      it('two concurrent cancels: one wins, the other gets CONFLICT, one event is written', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'running' })
        const s = service()
        const res = await Promise.allSettled([s.cancel(id), s.cancel(id)])
        expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const rejected = res.find((r) => r.status === 'rejected')
        expect(rejected).toMatchObject({ reason: { name: 'RunConflictError' } })
        const cancelled = await db
          .select()
          .from(events)
          .where(and(eq(events.runId, id), eq(events.type, 'run.status')))
          .orderBy(asc(events.id))
        expect(cancelled).toHaveLength(1)
      })

      it('a pause racing a cancel never leaves the run paused after both resolve cancelled', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'running' })
        const s = service()
        await Promise.allSettled([s.pause(id), s.cancel(id)])
        // Whichever order they land in, cancel applies last (paused to cancelled is a legal edge).
        expect((await s.get(id)).status).toBe('cancelled')
      })
    })

    describe('thread message paging with real timestamps', () => {
      it('pages without repeating or losing messages when created_at has microseconds', async () => {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        for (let i = 0; i < 6; i++) {
          await seedMessage(db, threadId, i % 2 === 0 ? 'user' : 'assistant', [
            { type: 'text', text: `m${i}` },
          ])
        }
        const s = service()
        const seen: string[] = []
        let before: MessageId | undefined
        for (let page = 0; page < 6; page++) {
          const got = await s.threadMessages({ threadId, limit: 2, before })
          if (got.length === 0) break
          seen.unshift(...got.map((m) => (m.parts[0] as { text: string }).text))
          before = got[0]?.id
        }
        expect(seen).toEqual(['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
      })

      it('does not lose a message that shares its created_at with the cursor message', async () => {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        const same = new Date(Date.UTC(2026, 0, 1, 0, 0, 5))
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'tie-a' }], same)
        await seedMessage(db, threadId, 'assistant', [{ type: 'text', text: 'tie-b' }], same)
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'tie-c' }], same)
        const s = service()
        const seen: string[] = []
        let before: MessageId | undefined
        for (let page = 0; page < 5; page++) {
          const got = await s.threadMessages({ threadId, limit: 1, before })
          if (got.length === 0) break
          seen.unshift(...got.map((m) => (m.parts[0] as { text: string }).text))
          before = got[0]?.id
        }
        expect(seen.sort()).toEqual(['tie-a', 'tie-b', 'tie-c'])
      })
    })

    describe('step writes after a cancel', () => {
      it('appendStep leaves a cancelled run untouched: no step rows, no usage change', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'cancelled' })
        const usage = { inputTokens: 9, outputTokens: 9 }
        const wrote = await createRunStore(db).appendStep(
          id,
          {
            idx: 0,
            assistantMessages: [{ role: 'assistant', content: 'late' }],
            usage,
            activeMsDelta: 0,
          },
          usage,
        )
        const steps = await db.select().from(runSteps).where(eq(runSteps.runId, id))
        const [row] = await db.select().from(runs).where(eq(runs.id, id))
        expect({ wrote, steps: steps.length, usage: row?.usage }).toEqual({
          wrote: 'not_running',
          steps: 0,
          usage: { inputTokens: 0, outputTokens: 0 },
        })
      })
    })
  })
}
