import { newId, Run, type RunId } from '@mawl/contracts'
import { schema } from '@mawl/db'
import { asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.ts'
import type { MadeServiceDb } from '../providers/service-suite.ts'
import { EntityNotFoundError, RunConflictError } from './errors.ts'
import { RunRegistry } from './registry.ts'
import { createRunService } from './service.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'

const { events, messages, profiles, threads } = schema

/** One database per suite: every test seeds its own profile, so tests never collide. */
export function describeRunService(name: string, make: () => Promise<MadeServiceDb>): void {
  describe(name, () => {
    let made: MadeServiceDb
    // reason: assigned in beforeAll, read only inside tests.
    let db!: MadeServiceDb['db']
    let enqueued: RunId[]
    let enqueueFails: boolean
    let registry: RunRegistry

    beforeAll(async () => {
      made = await make()
      await made.migrate()
      db = made.db
    }, 120_000)

    afterAll(async () => {
      await made.close()
    })

    beforeEach(() => {
      enqueued = []
      enqueueFails = false
      registry = new RunRegistry()
    })

    const service = () =>
      createRunService({
        db,
        registry,
        logger: createLogger({ level: 'silent' }),
        enqueue: async (runId) => {
          if (enqueueFails) throw new Error('queue down')
          enqueued.push(runId)
        },
      })

    const eventsOf = (runId: RunId) =>
      db.select().from(events).where(eq(events.runId, runId)).orderBy(asc(events.id))

    describe('start', () => {
      it('creates the thread, the user message and a queued run together, then enqueues', async () => {
        const profileId = await seedProfile(db)
        const run = await service().start({
          profileId,
          prompt: 'Plan my week',
          budget: { maxSteps: 3 },
        })

        expect(Run.safeParse(run).success).toBe(true)
        expect(run).toMatchObject({
          profileId,
          trigger: 'user',
          status: 'queued',
          budget: { maxSteps: 3 },
          usage: { inputTokens: 0, outputTokens: 0 },
          startedAt: null,
          endedAt: null,
          error: null,
        })
        expect(run.threadId).not.toBeNull()
        const [thread] = await db
          .select()
          .from(threads)
          .where(eq(threads.id, run.threadId as never))
        expect(thread).toMatchObject({ profileId, channel: 'app', title: 'Plan my week' })
        expect(thread?.lastEventAt).not.toBeNull()
        const msgs = await db
          .select()
          .from(messages)
          .where(eq(messages.threadId, run.threadId as never))
        expect(msgs).toHaveLength(1)
        expect(msgs[0]).toMatchObject({
          role: 'user',
          runId: run.id,
          parts: [{ type: 'text', text: 'Plan my week' }],
        })
        const ev = await eventsOf(run.id)
        expect(ev.map((e) => e.payload)).toEqual([{ status: 'queued' }])
        expect(enqueued).toEqual([run.id])
      })

      it('titles a new thread with the first 60 characters of the prompt', async () => {
        const profileId = await seedProfile(db)
        const run = await service().start({ profileId, prompt: `${'x'.repeat(100)}` })
        const [thread] = await db
          .select()
          .from(threads)
          .where(eq(threads.id, run.threadId as never))
        expect(thread?.title).toBe('x'.repeat(60))
      })

      it('adds to an existing thread of the same profile and bumps last_event_at', async () => {
        const profileId = await seedProfile(db)
        const old = new Date('2020-01-01T00:00:00.000Z')
        const threadId = await seedThread(db, profileId, old)
        const run = await service().start({ profileId, threadId, prompt: 'again' })
        expect(run.threadId).toBe(threadId)
        const [thread] = await db.select().from(threads).where(eq(threads.id, threadId))
        expect(thread?.lastEventAt?.getTime()).toBeGreaterThan(old.getTime())
        expect(thread?.title).toBeNull()
      })

      it('rejects an unknown profile and writes nothing', async () => {
        const unknown = newId('profile')
        await expect(service().start({ profileId: unknown, prompt: 'hi' })).rejects.toMatchObject({
          name: 'EntityNotFoundError',
          entity: 'profile',
          id: unknown,
        })
        expect(enqueued).toEqual([])
      })

      it('rejects an archived profile like an unknown one and writes nothing', async () => {
        const profileId = await seedProfile(db)
        await db.update(profiles).set({ archivedAt: new Date() }).where(eq(profiles.id, profileId))
        await expect(service().start({ profileId, prompt: 'hi' })).rejects.toMatchObject({
          name: 'EntityNotFoundError',
          entity: 'profile',
          id: profileId,
        })
        expect(enqueued).toEqual([])
        expect(await db.select().from(threads).where(eq(threads.profileId, profileId))).toEqual([])
      })

      it('rejects an unknown thread and a thread that belongs to another profile', async () => {
        const profileId = await seedProfile(db)
        const other = await seedProfile(db)
        const foreign = await seedThread(db, other)
        const s = service()
        await expect(
          s.start({ profileId, threadId: newId('thread'), prompt: 'hi' }),
        ).rejects.toBeInstanceOf(EntityNotFoundError)
        await expect(s.start({ profileId, threadId: foreign, prompt: 'hi' })).rejects.toMatchObject(
          {
            entity: 'thread',
          },
        )
        expect(enqueued).toEqual([])
      })

      it('keeps the run queued and returns it when the queue is down', async () => {
        const profileId = await seedProfile(db)
        enqueueFails = true
        const run = await service().start({ profileId, prompt: 'hi' })
        expect(run.status).toBe('queued')
      })
    })

    describe('get', () => {
      it('returns the run, or NOT_FOUND', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId)
        expect((await service().get(id)).id).toBe(id)
        await expect(service().get(newId('run'))).rejects.toBeInstanceOf(EntityNotFoundError)
      })
    })

    describe('cancel', () => {
      it.each(['queued', 'running', 'paused', 'waiting_user'] as const)(
        'cancels a %s run, records the event and aborts the executing job',
        async (status) => {
          const profileId = await seedProfile(db)
          const id = await seedRun(db, profileId, { status })
          const controller = registry.register(id) as AbortController

          const run = await service().cancel(id)

          expect(run).toMatchObject({ id, status: 'cancelled' })
          expect(run.endedAt).not.toBeNull()
          expect((await eventsOf(id)).at(-1)?.payload).toEqual({
            status: 'cancelled',
            prevStatus: status,
          })
          expect(controller.signal.aborted).toBe(true)
          expect(controller.signal.reason).toBe('cancel')
        },
      )

      it.each(['succeeded', 'failed', 'cancelled'] as const)(
        'answers CONFLICT for a %s run',
        async (status) => {
          const profileId = await seedProfile(db)
          const id = await seedRun(db, profileId, { status })
          await expect(service().cancel(id)).rejects.toMatchObject({
            name: 'RunConflictError',
            from: status,
            to: 'cancelled',
          })
        },
      )

      it('answers NOT_FOUND for an unknown run', async () => {
        await expect(service().cancel(newId('run'))).rejects.toBeInstanceOf(EntityNotFoundError)
      })
    })

    describe('pause', () => {
      it('pauses a running run and aborts the executing job', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'running' })
        const controller = registry.register(id) as AbortController
        const run = await service().pause(id)
        expect(run.status).toBe('paused')
        expect(controller.signal.reason).toBe('pause')
        expect((await eventsOf(id)).at(-1)?.payload).toEqual({
          status: 'paused',
          prevStatus: 'running',
        })
      })

      it('answers CONFLICT unless the run is running', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'queued' })
        await expect(service().pause(id)).rejects.toMatchObject({
          from: 'queued',
          to: 'paused',
        })
        const controller = registry.register(id) as AbortController
        expect(controller.signal.aborted).toBe(false)
      })
    })

    describe('resume', () => {
      it('moves a paused run back to queued and enqueues it', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'paused' })
        const run = await service().resume(id)
        expect(run.status).toBe('queued')
        expect(enqueued).toEqual([id])
        expect((await eventsOf(id)).at(-1)?.payload).toEqual({
          status: 'queued',
          prevStatus: 'paused',
        })
      })

      it('answers CONFLICT for a run that is not paused and enqueues nothing', async () => {
        const profileId = await seedProfile(db)
        const id = await seedRun(db, profileId, { status: 'running' })
        await expect(service().resume(id)).rejects.toBeInstanceOf(RunConflictError)
        expect(enqueued).toEqual([])
      })
    })

    describe('threads', () => {
      it('lists a profile threads by last activity, newest first, and only its own', async () => {
        const profileId = await seedProfile(db)
        const other = await seedProfile(db)
        const old = await seedThread(db, profileId, new Date('2026-01-01T00:00:00.000Z'))
        const fresh = await seedThread(db, profileId, new Date('2026-03-01T00:00:00.000Z'))
        const never = await seedThread(db, profileId, null)
        await seedThread(db, other, new Date('2026-04-01T00:00:00.000Z'))

        const list = await service().listThreads(profileId)

        expect(list.map((t) => t.id)).toEqual([fresh, old, never])
        expect(list[0]).toMatchObject({ profileId, channel: 'app', peer: null })
      })

      it('answers NOT_FOUND when listing threads of an unknown profile', async () => {
        await expect(service().listThreads(newId('profile'))).rejects.toBeInstanceOf(
          EntityNotFoundError,
        )
      })

      async function threadWithMessages(n: number) {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        const at = (i: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, i))
        for (let i = 0; i < n; i++) {
          await seedMessage(
            db,
            threadId,
            i % 2 === 0 ? 'user' : 'assistant',
            [{ type: 'text', text: `m${i}` }],
            at(i),
          )
        }
        return { threadId, at }
      }
      const texts = (ms: Array<{ parts: Array<{ type: string; text?: string }> }>) =>
        ms.map((m) => m.parts[0]?.text)

      it('returns the latest messages in chronological order', async () => {
        const { threadId } = await threadWithMessages(5)
        const res = await service().threadMessages({ threadId, limit: 3 })
        expect(texts(res)).toEqual(['m2', 'm3', 'm4'])
        expect(res[0]).toMatchObject({ threadId, role: 'user', runId: null })
      })

      it('pages backwards with the before cursor', async () => {
        const { threadId } = await threadWithMessages(5)
        const s = service()
        const first = await s.threadMessages({ threadId, limit: 2 })
        const cursor = first[0]?.id
        expect(texts(first)).toEqual(['m3', 'm4'])
        const second = await s.threadMessages({ threadId, limit: 2, before: cursor })
        expect(texts(second)).toEqual(['m1', 'm2'])
        const last = await s.threadMessages({ threadId, limit: 2, before: second[0]?.id })
        expect(texts(last)).toEqual(['m0'])
      })

      it('answers NOT_FOUND for a cursor that is not a message of this thread', async () => {
        const { threadId } = await threadWithMessages(1)
        const other = await threadWithMessages(1)
        const foreign = (await service().threadMessages({ threadId: other.threadId }))[0]
        await expect(
          service().threadMessages({ threadId, before: foreign?.id }),
        ).rejects.toMatchObject({ name: 'EntityNotFoundError', entity: 'message' })
        await expect(
          service().threadMessages({ threadId, before: newId('message') }),
        ).rejects.toBeInstanceOf(EntityNotFoundError)
      })

      it('defaults to 50 messages and answers NOT_FOUND for an unknown thread', async () => {
        const { threadId } = await threadWithMessages(3)
        expect(await service().threadMessages({ threadId })).toHaveLength(3)
        await expect(
          service().threadMessages({ threadId: newId('thread') }),
        ).rejects.toBeInstanceOf(EntityNotFoundError)
      })
    })

    it('reads runs written by the store back through the public shape', async () => {
      const profileId = await seedProfile(db)
      const id = await seedRun(db, profileId, {
        status: 'failed',
        error: 'budget_steps',
        startedAt: new Date('2026-01-02T03:04:05.000Z'),
        endedAt: new Date('2026-01-02T03:05:05.000Z'),
      })
      const run = await service().get(id)
      expect(Run.safeParse(run).success).toBe(true)
      expect(run).toMatchObject({
        error: 'budget_steps',
        startedAt: '2026-01-02T03:04:05.000Z',
        endedAt: '2026-01-02T03:05:05.000Z',
      })
    })
  })
}
