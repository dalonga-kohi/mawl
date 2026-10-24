import { newId, type RunId } from '@mawl/contracts'
import type { ModelMessage, ToolResultRecord } from '@mawl/core'
import { schema } from '@mawl/db'
import { and, asc, count, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { MadeServiceDb } from '../providers/service-suite.ts'
import { createArtifactStore } from './artifacts.ts'
import { insertEvent, insertRunStep } from './repo.ts'
import { createRunStore } from './store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'

const { runs, runSteps, events, messages, threads, runWaits } = schema

/** One database per suite: every test seeds its own profile, so tests never collide. */
export function describeRunStore(name: string, make: () => Promise<MadeServiceDb>): void {
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

    const eventsOf = (runId: RunId) =>
      db.select().from(events).where(eq(events.runId, runId)).orderBy(asc(events.id))

    async function seed(status: 'queued' | 'running' = 'queued') {
      const profileId = await seedProfile(db)
      const threadId = await seedThread(db, profileId)
      const runId = await seedRun(db, profileId, { threadId, status })
      return { profileId, threadId, runId, store: createRunStore(db) }
    }

    describe('repository helper', () => {
      it('stores a raw JS null event payload as JSON null, not SQL NULL', async () => {
        const { profileId, runId } = await seed()
        await insertEvent(db, { profileId, runId, type: 'test.null', payload: null })
        const res = await db.execute(
          sql`select (payload_json is null) as sql_null, (payload_json = 'null'::jsonb) as json_null from events where run_id = ${runId} and type = 'test.null'`,
        )
        expect((res as { rows: unknown[] }).rows).toEqual([{ sql_null: false, json_null: true }])
      })

      it('stores a raw JS null step input as JSON null, not SQL NULL', async () => {
        const { runId } = await seed()
        const id = await insertRunStep(db, {
          runId,
          idx: 0,
          kind: 'model',
          input: null,
          usage: null,
        })
        expect(id).not.toBeNull()
        const res = await db.execute(
          sql`select (input_json is null) as sql_null, (input_json = 'null'::jsonb) as json_null from run_steps where run_id = ${runId}`,
        )
        expect((res as { rows: unknown[] }).rows).toEqual([{ sql_null: false, json_null: true }])
      })

      it('returns null instead of writing a second step with the same idx', async () => {
        const { runId } = await seed()
        const step = { runId, idx: 0, kind: 'model', input: { a: 1 }, usage: null } as const
        expect(await insertRunStep(db, step)).not.toBeNull()
        expect(await insertRunStep(db, { ...step, input: { a: 2 } })).toBeNull()
        const [n] = await db.select({ n: count() }).from(runSteps).where(eq(runSteps.runId, runId))
        expect(n?.n).toBe(1)
      })
    })

    describe('load and status', () => {
      it('loads the run with its profile and reports the status', async () => {
        const { runId, profileId, store } = await seed()
        const ctx = await store.load(runId)
        expect(ctx?.run).toMatchObject({
          id: runId,
          profileId,
          status: 'queued',
          startedAt: null,
          usage: { inputTokens: 0, outputTokens: 0 },
        })
        expect(ctx?.profile).toMatchObject({ id: profileId, personaMd: 'You are Ada.' })
        expect(await store.status(runId)).toBe('queued')
      })

      it('returns null for an unknown run', async () => {
        const { store } = await seed()
        const unknown = newId('run')
        expect(await store.load(unknown)).toBeNull()
        expect(await store.status(unknown)).toBeNull()
      })
    })

    describe('transition', () => {
      it('moves queued to running once, records one event and stamps started_at', async () => {
        const { runId, store } = await seed()
        const startedAt = new Date('2026-01-02T03:04:05.000Z')
        expect(await store.transition(runId, 'queued', 'running', { startedAt })).toBe(true)
        expect(await store.transition(runId, 'queued', 'running', { startedAt })).toBe(false)

        const ev = await eventsOf(runId)
        expect(ev).toHaveLength(1)
        expect(ev[0]?.type).toBe('run.status')
        expect(ev[0]?.payload).toEqual({ status: 'running', prevStatus: 'queued' })
        const ctx = await store.load(runId)
        expect(ctx?.run.status).toBe('running')
        expect(ctx?.run.startedAt?.toISOString()).toBe(startedAt.toISOString())
      })

      it('stores the error code, end time and usage on failure, and the code in the event', async () => {
        const { runId, store } = await seed('running')
        const endedAt = new Date('2026-01-02T03:05:00.000Z')
        const ok = await store.transition(runId, 'running', 'failed', {
          error: 'plan_limit_reached',
          endedAt,
          usage: { inputTokens: 5, outputTokens: 6 },
        })
        expect(ok).toBe(true)
        const [row] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(row).toMatchObject({
          status: 'failed',
          error: 'plan_limit_reached',
          usage: { inputTokens: 5, outputTokens: 6 },
        })
        expect(row?.endedAt?.toISOString()).toBe(endedAt.toISOString())
        expect((await eventsOf(runId))[0]?.payload).toEqual({
          status: 'failed',
          prevStatus: 'running',
          error: 'plan_limit_reached',
        })
      })

      it('loses the CAS when someone else already changed the status, writing nothing', async () => {
        const { runId, store } = await seed('running')
        expect(await store.transition(runId, 'running', 'cancelled')).toBe(true)
        expect(await store.transition(runId, 'running', 'succeeded')).toBe(false)
        expect(await store.status(runId)).toBe('cancelled')
        expect(await eventsOf(runId)).toHaveLength(1)
      })

      it('refuses an edge the state machine does not have', async () => {
        const { runId, store } = await seed()
        await expect(store.transition(runId, 'queued', 'failed')).rejects.toThrow(/illegal/i)
        expect(await store.status(runId)).toBe('queued')
      })
    })

    describe('appendStep, appendToolStep and steps', () => {
      const assistant: ModelMessage = { role: 'assistant', content: [{ type: 'text', text: 'hi' }] }
      const toolMsg: ModelMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'c1',
            toolName: 't',
            output: { type: 'json', value: { ok: true } },
          },
        ],
      }
      const usage = { inputTokens: 7, outputTokens: 3 }
      const modelStep = (idx: number, activeMsDelta = 0) => ({
        idx,
        assistantMessages: [assistant],
        usage,
        activeMsDelta,
      })

      it('writes the model row with its run.step event, usage and active time', async () => {
        const { runId, store } = await seed('running')
        expect(await store.appendStep(runId, modelStep(0, 40), usage)).toBe('written')
        const rows = await store.steps(runId)
        expect(rows).toEqual([{ idx: 0, kind: 'model', messages: [assistant], usage }])
        const stepEvents = (await eventsOf(runId)).filter((e) => e.type === 'run.step')
        expect(stepEvents.map((e) => e.payload)).toMatchObject([{ idx: 0, kind: 'model', usage }])
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run?.usage).toEqual(usage)
        expect(run?.activeMs).toBe(40)
      })

      it('writes the tool row with its run.step event and active time', async () => {
        const { runId, store } = await seed('running')
        await store.appendStep(runId, modelStep(0), usage)
        expect(
          await store.appendToolStep(runId, { idx: 1, toolMessages: [toolMsg], activeMsDelta: 9 }),
        ).toBe('written')
        const rows = await store.steps(runId)
        expect(rows.map((r) => [r.idx, r.kind, r.usage])).toEqual([
          [0, 'model', usage],
          [1, 'tool', null],
        ])
        expect(rows[1]?.messages).toEqual([toolMsg])
        const stepEvents = (await eventsOf(runId)).filter((e) => e.type === 'run.step')
        expect(stepEvents.at(-1)?.payload).toMatchObject({ idx: 1, kind: 'tool' })
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run?.activeMs).toBe(9)
      })

      it('adds active time on transition and success', async () => {
        const { runId, store } = await seed('running')
        await store.transition(runId, 'running', 'paused', { activeMsDelta: 7 })
        await store.transition(runId, 'paused', 'queued')
        await store.transition(runId, 'queued', 'running')
        await store.succeed(runId, {
          text: 't',
          usage: { inputTokens: 1, outputTokens: 1 },
          endedAt: new Date(),
          activeMsDelta: 5,
        })
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run?.activeMs).toBe(12)
      })

      it('answers duplicate and writes nothing when the model row idx exists', async () => {
        const { runId, store } = await seed('running')
        await store.appendStep(runId, modelStep(0), usage)
        const again = await store.appendStep(runId, modelStep(0, 5), {
          inputTokens: 99,
          outputTokens: 99,
        })
        expect(again).toBe('duplicate')
        expect(await store.steps(runId)).toHaveLength(1)
        expect((await eventsOf(runId)).filter((e) => e.type === 'run.step')).toHaveLength(1)
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run?.usage).toEqual(usage)
      })

      it('answers duplicate for a tool row idx that exists', async () => {
        const { runId, store } = await seed('running')
        await store.appendStep(runId, modelStep(0), usage)
        await store.appendToolStep(runId, { idx: 1, toolMessages: [toolMsg], activeMsDelta: 0 })
        expect(
          await store.appendToolStep(runId, { idx: 1, toolMessages: [toolMsg], activeMsDelta: 3 }),
        ).toBe('duplicate')
        expect((await eventsOf(runId)).filter((e) => e.type === 'run.step')).toHaveLength(2)
      })

      it('writes no tool row once the run left running', async () => {
        const { runId, store } = await seed('running')
        await store.appendStep(runId, modelStep(0), usage)
        await store.transition(runId, 'running', 'cancelled')
        expect(
          await store.appendToolStep(runId, { idx: 1, toolMessages: [toolMsg], activeMsDelta: 0 }),
        ).toBe('not_running')
        expect(await store.steps(runId)).toHaveLength(1)
      })
    })

    describe('tool ledger', () => {
      const record = (value: string, extra: Partial<ToolResultRecord> = {}): ToolResultRecord => ({
        toolName: 'notify',
        output: { type: 'text', value },
        isError: false,
        preview: value,
        artifactId: null,
        ...extra,
      })
      const key = { stepIdx: 0, toolCallId: 'call_1' }

      it('records a tool call event with the redacted args and action class', async () => {
        const { runId, profileId, store } = await seed('running')
        await store.recordToolCall(runId, {
          toolCallId: 'call_1',
          tool: 'web_fetch',
          argsRedacted: { url: 'https://example.com/' },
          actionClass: 'read',
        })
        const [e] = (await eventsOf(runId)).filter((x) => x.type === 'run.tool_call')
        expect(e).toMatchObject({
          profileId,
          payload: {
            toolCallId: 'call_1',
            tool: 'web_fetch',
            argsRedacted: { url: 'https://example.com/' },
            actionClass: 'read',
          },
        })
      })

      it('stores a result once with its event and emitted events; the first writer wins', async () => {
        const { runId, profileId, store } = await seed('running')
        expect(await store.toolResult(runId, key)).toBeNull()
        const emit = [
          {
            type: 'notify' as const,
            payload: { title: 'Done', body: 'b', level: 'info' as const },
          },
        ]
        expect(await store.recordToolResult(runId, key, record('first'), emit)).toEqual(
          record('first'),
        )
        expect(await store.recordToolResult(runId, key, record('second'), emit)).toEqual(
          record('first'),
        )
        expect(await store.toolResult(runId, key)).toEqual(record('first'))
        const evs = await eventsOf(runId)
        expect(evs.filter((e) => e.type === 'run.tool_result').map((e) => e.payload)).toEqual([
          { toolCallId: 'call_1', preview: 'first', isError: false },
        ])
        const notes = evs.filter((e) => e.type === 'notify')
        expect(notes).toHaveLength(1)
        expect(notes[0]).toMatchObject({
          profileId,
          payload: { title: 'Done', body: 'b', level: 'info' },
        })
      })

      it('keys results by step idx and tool call id', async () => {
        const { runId, store } = await seed('running')
        await store.recordToolResult(runId, key, record('a'), [])
        await store.recordToolResult(runId, { stepIdx: 2, toolCallId: 'call_1' }, record('b'), [])
        expect((await store.toolResult(runId, { stepIdx: 2, toolCallId: 'call_1' }))?.preview).toBe(
          'b',
        )
      })

      it('carries the artifact id into the record and the event', async () => {
        const { runId, profileId, store } = await seed('running')
        const artifacts = createArtifactStore(db)
        const artifactId = await artifacts.create({
          profileId,
          runId,
          mime: 'text/plain',
          content: 'big',
          preview: 'b',
          tokenCount: 1,
        })
        await store.recordToolResult(runId, key, record('p', { artifactId }), [])
        expect((await store.toolResult(runId, key))?.artifactId).toBe(artifactId)
        const [e] = (await eventsOf(runId)).filter((x) => x.type === 'run.tool_result')
        expect(e?.payload).toMatchObject({ artifactId })
      })
    })

    describe('park', () => {
      const wait = {
        kind: 'question' as const,
        payload: { question: 'Blue or green?' },
        stepIdx: 0,
        toolCallId: 'call_1',
      }

      it('records the wait and moves running to waiting_user with an event, together', async () => {
        const { runId, store } = await seed('running')
        expect(await store.park(runId, wait, 25)).toBe(true)
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run).toMatchObject({ status: 'waiting_user', activeMs: 25 })
        const [row] = await db.select().from(runWaits).where(eq(runWaits.runId, runId))
        expect(row).toMatchObject({
          stepIdx: 0,
          toolCallId: 'call_1',
          kind: 'question',
          payload: { question: 'Blue or green?' },
          answer: null,
          resolvedAt: null,
        })
        expect((await eventsOf(runId)).at(-1)?.payload).toEqual({
          status: 'waiting_user',
          prevStatus: 'running',
        })
      })

      it('writes nothing when the run is no longer running', async () => {
        const { runId, store } = await seed('running')
        await store.transition(runId, 'running', 'paused')
        expect(await store.park(runId, wait, 0)).toBe(false)
        expect(await db.select().from(runWaits).where(eq(runWaits.runId, runId))).toHaveLength(0)
      })
    })

    describe('succeed', () => {
      it('inserts one assistant message, finishes the run and bumps the thread, together', async () => {
        const { runId, threadId, store } = await seed('running')
        const usage = { inputTokens: 4, outputTokens: 9 }
        const endedAt = new Date('2026-01-02T03:06:00.000Z')

        expect(
          await store.succeed(runId, { text: 'All done', usage, endedAt, activeMsDelta: 0 }),
        ).toBe(true)

        const msgs = await db.select().from(messages).where(eq(messages.threadId, threadId))
        expect(msgs).toHaveLength(1)
        expect(msgs[0]).toMatchObject({
          role: 'assistant',
          runId,
          parts: [{ type: 'text', text: 'All done' }],
          tokenCount: 9,
        })
        const [run] = await db.select().from(runs).where(eq(runs.id, runId))
        expect(run).toMatchObject({ status: 'succeeded', usage })
        expect(run?.endedAt?.toISOString()).toBe(endedAt.toISOString())
        const [thread] = await db.select().from(threads).where(eq(threads.id, threadId))
        expect(thread?.lastEventAt).not.toBeNull()
        expect((await eventsOf(runId)).at(-1)?.payload).toEqual({
          status: 'succeeded',
          prevStatus: 'running',
        })
      })

      it('writes nothing when the run is no longer running', async () => {
        const { runId, threadId, store } = await seed('running')
        await store.transition(runId, 'running', 'cancelled')
        const ok = await store.succeed(runId, {
          text: 'late',
          usage: { inputTokens: 1, outputTokens: 1 },
          endedAt: new Date(),
          activeMsDelta: 0,
        })
        expect(ok).toBe(false)
        const [n] = await db
          .select({ n: count() })
          .from(messages)
          .where(eq(messages.threadId, threadId))
        expect(n?.n).toBe(0)
        expect(await store.status(runId)).toBe('cancelled')
      })

      it('stores no text part for an empty answer', async () => {
        const { runId, threadId, store } = await seed('running')
        await store.succeed(runId, {
          text: '',
          usage: { inputTokens: 1, outputTokens: 0 },
          endedAt: new Date(),
          activeMsDelta: 0,
        })
        const [m] = await db
          .select()
          .from(messages)
          .where(and(eq(messages.threadId, threadId)))
        expect(m?.parts).toEqual([])
      })
    })

    describe('history', () => {
      it('returns user and assistant text oldest first, skipping non-text parts', async () => {
        const profileId = await seedProfile(db)
        const threadId = await seedThread(db, profileId)
        const runId = await seedRun(db, profileId, { threadId })
        const t = (s: string) => new Date(`2026-01-02T03:04:0${s}.000Z`)
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'first' }], t('1'))
        await seedMessage(
          db,
          threadId,
          'assistant',
          [
            { type: 'reasoning', text: 'hmm' },
            { type: 'text', text: 'second' },
            { type: 'tool_call', toolCallId: 'c', tool: 'x', args: null },
          ],
          t('2'),
        )
        await seedMessage(db, threadId, 'assistant', [{ type: 'reasoning', text: 'only' }], t('3'))
        await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'third' }], t('4'), runId)

        const store = createRunStore(db)
        const ctx = await store.load(runId)
        expect(ctx).not.toBeNull()
        if (!ctx) return
        expect(await store.history(ctx.run)).toEqual([
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ])
      })

      it('is empty for a run without a thread', async () => {
        const profileId = await seedProfile(db)
        const runId = await seedRun(db, profileId, { threadId: null })
        const store = createRunStore(db)
        const ctx = await store.load(runId)
        if (!ctx) throw new Error('missing run')
        expect(await store.history(ctx.run)).toEqual([])
      })
    })
  })
}
