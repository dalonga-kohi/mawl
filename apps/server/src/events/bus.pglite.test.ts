import type { LenientEnvelope, ProfileId } from '@faire/contracts'
import { schema } from '@faire/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { insertEvent } from '../runs/repo.ts'
import { seedProfile, seedRun } from '../runs/test-util.ts'
import { createEventBus, type EventBus } from './bus.ts'
import { type FakeTimers, fakeTimers, pgliteDb, pgliteSource } from './test-util.ts'

const { events } = schema

const notifyPayload = { title: 't', body: 'b', level: 'info' as const }

describe('event bus on PGlite', () => {
  const cleanup: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  async function setup(over: { gapGraceMs?: number; pageSize?: number } = {}) {
    const env = await pgliteDb()
    cleanup.push(env.close)
    const src = pgliteSource(env.client)
    const timers: FakeTimers = fakeTimers()
    const profileId = await seedProfile(env.db)
    const before: LenientEnvelope[] = []
    const bus: EventBus = createEventBus({
      db: env.db,
      source: src.source,
      logger: createLogger({ level: 'silent' }),
      timers,
      now: () => timers.now(),
      random: () => 0,
      beforePersisted: (e) => void before.push(e),
      ...over,
    })
    cleanup.push(() => bus.stop())
    const got: LenientEnvelope[] = []
    bus.subscribe((e) => void got.push(e))
    const emit = (p: ProfileId = profileId, runId: null = null) =>
      insertEvent(env.db, { profileId: p, runId, type: 'notify', payload: notifyPayload })
    const ids = () => got.map((e) => e.id)
    return { env, src, timers, profileId, bus, got, before, emit, ids }
  }

  it('delivers committed events to every subscriber in id order as wire envelopes', async () => {
    const { bus, got, emit, profileId, env } = await setup()
    const second: LenientEnvelope[] = []
    bus.subscribe((e) => void second.push(e))
    await bus.start()

    const runId = await seedRun(env.db, profileId)
    const a = await emit()
    const b = await insertEvent(env.db, {
      profileId,
      runId,
      type: 'notify',
      payload: notifyPayload,
    })

    await vi.waitFor(() => expect(got).toHaveLength(2))
    expect(got.map((e) => e.id)).toEqual([String(a), String(b)])
    expect(got[1]).toMatchObject({
      v: 1,
      type: 'notify',
      profileId,
      runId,
      payload: notifyPayload,
      ts: expect.stringMatching(/Z$/),
    })
    expect(got[0]).not.toHaveProperty('runId')
    expect(second).toEqual(got)
    expect(bus.lastSeen).toBe(b)
  })

  it('starts after the newest existing event: history is not replayed to live listeners', async () => {
    const { bus, got, emit, ids } = await setup()
    const old = await emit()
    await bus.start()
    expect(bus.lastSeen).toBe(old)
    const fresh = await emit()
    await vi.waitFor(() => expect(ids()).toEqual([String(fresh)]))
    expect(got).toHaveLength(1)
  })

  it('catches up on events whose notification was missed when the next one arrives', async () => {
    const { bus, env, profileId, emit, ids } = await setup()
    await bus.start()
    // Raw inserts: no NOTIFY, as if the notifications were lost or coalesced.
    const rows = await env.db
      .insert(events)
      .values([1, 2, 3].map(() => ({ profileId, type: 'notify', payload: notifyPayload })))
      .returning({ id: events.id })
    const last = await emit()
    await vi.waitFor(() => expect(ids()).toHaveLength(4))
    expect(ids()).toEqual([...rows.map((r) => String(r.id)), String(last)])
  })

  it('pages through a backlog larger than one page', async () => {
    const { bus, env, profileId, emit, ids } = await setup({ pageSize: 2 })
    await bus.start()
    await env.db
      .insert(events)
      .values(
        Array.from({ length: 5 }, () => ({ profileId, type: 'notify', payload: notifyPayload })),
      )
    await emit()
    await vi.waitFor(() => expect(ids()).toHaveLength(6))
    expect(ids()).toEqual([...ids()].sort((x, y) => Number(x) - Number(y)))
  })

  it('reconnects with backoff after the listen connection drops and catches up on what it missed', async () => {
    const { bus, src, timers, emit, ids } = await setup()
    await bus.start()
    await src.drop()
    expect(bus.status).toBe('reconnecting')
    expect(timers.pending.map((t) => t.ms)).toEqual([1000])

    const missed = await emit() // nobody is listening now
    src.failConnects(1)
    timers.advance(1000) // first retry fails
    await vi.waitFor(() => expect(timers.pending.map((t) => t.ms)).toEqual([2000]))
    expect(ids()).toEqual([])

    timers.advance(2000)
    await vi.waitFor(() => expect(ids()).toEqual([String(missed)]))
    expect(bus.status).toBe('listening')
    expect(src.connects).toBe(3)

    const live = await emit()
    await vi.waitFor(() => expect(ids()).toEqual([String(missed), String(live)]))
  })

  it('caps the reconnect delay at 30 s', async () => {
    const { bus, src, timers } = await setup()
    await bus.start()
    src.failConnects(10)
    await src.drop()
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      const [next] = timers.pending
      if (!next) throw new Error('no reconnect scheduled')
      delays.push(next.ms)
      const before = src.connects
      timers.advance(next.ms)
      await vi.waitFor(() => expect(src.connects).toBe(before + 1))
      await vi.waitFor(() => expect(timers.pending).toHaveLength(1))
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
  })

  it('keeps reconnecting in the background when the first LISTEN fails at start', async () => {
    const { bus, src, timers, emit, ids } = await setup()
    src.failConnects(1)
    await bus.start()
    expect(bus.status).toBe('reconnecting')
    const early = await emit()
    timers.advance(1000)
    await vi.waitFor(() => expect(ids()).toEqual([String(early)]))
  })

  it('holds back events behind a gap in ids until the gap fills', async () => {
    const { bus, env, profileId, timers, ids } = await setup()
    await bus.start()
    const row = (id: number) => ({ id, profileId, type: 'notify', payload: notifyPayload })
    await env.db.insert(events).values(row(2))
    await env.client.query(`select pg_notify('faire_events', '{}')`)
    await vi.waitFor(() => expect(timers.pending.map((t) => t.ms)).toEqual([250]))
    expect(ids()).toEqual([])

    // The transaction holding id 1 commits late.
    await env.db.insert(events).values(row(1))
    await env.client.query(`select pg_notify('faire_events', '{}')`)
    await vi.waitFor(() => expect(ids()).toEqual(['1', '2']))
  })

  it('delivers past a gap that never fills once the grace period is over', async () => {
    const { bus, env, profileId, timers, ids } = await setup({ gapGraceMs: 2000 })
    await bus.start()
    // id 1 is burnt (a rolled-back transaction), id 2 is real.
    await env.db.insert(events).values({ id: 2, profileId, type: 'notify', payload: notifyPayload })
    await env.client.query(`select pg_notify('faire_events', '{}')`)
    await vi.waitFor(() => expect(timers.pending).toHaveLength(1))
    timers.advance(1000)
    await vi.waitFor(() => expect(timers.pending).toHaveLength(1))
    expect(ids()).toEqual([])
    timers.advance(1000)
    await vi.waitFor(() => expect(ids()).toEqual(['2']))
  })

  it('publishEphemeral stamps the newest persisted id and reaches subscribers without a row', async () => {
    const { bus, env, profileId, got, emit } = await setup()
    await bus.start()
    const persisted = await emit()
    await vi.waitFor(() => expect(got).toHaveLength(1))

    bus.publishEphemeral({
      profileId,
      type: 'run.delta',
      payload: { text: 'hi', stepIdx: 0 },
    })
    expect(got.at(-1)).toMatchObject({
      v: 1,
      id: String(persisted),
      type: 'run.delta',
      payload: { text: 'hi', stepIdx: 0 },
    })
    const rows = await env.db.select().from(events)
    expect(rows).toHaveLength(1)
  })

  it('never lets a throwing subscriber stop the others or the bus', async () => {
    const { bus, got, emit } = await setup()
    bus.subscribe(() => {
      throw new Error('boom')
    })
    await bus.start()
    await emit()
    await emit()
    await vi.waitFor(() => expect(got).toHaveLength(2))
  })

  it('runs beforePersisted ahead of subscribers for each persisted event, never for ephemeral ones', async () => {
    const { bus, before, got, emit, profileId } = await setup()
    const seenByHook: number[] = []
    // The hook has run for event N by the time any subscriber sees it.
    bus.subscribe(() => void seenByHook.push(before.length))
    await bus.start()
    const id = await emit()
    await vi.waitFor(() => expect(got).toHaveLength(1))
    expect(seenByHook).toEqual([1])
    expect(before.map((e) => e.id)).toEqual([String(id)])
    bus.publishEphemeral({ profileId, type: 'run.delta', payload: { text: 'x' } })
    expect(before).toHaveLength(1)
  })
  it('unsubscribe stops delivery and counts listeners', async () => {
    const { bus, emit } = await setup()
    await bus.start()
    const seen: string[] = []
    const off = bus.subscribe((e) => void seen.push(e.id))
    expect(bus.listenerCount).toBe(2)
    off()
    expect(bus.listenerCount).toBe(1)
    await emit()
    await vi.waitFor(() => expect(bus.lastSeen).toBeGreaterThan(0))
    expect(seen).toEqual([])
  })

  it('replay returns persisted events after since up to upTo for matching topics, in id order', async () => {
    const { bus, env, profileId, emit } = await setup()
    const other = await seedProfile(env.db)
    await bus.start()
    const a = await emit()
    await emit(other)
    const c = await emit()
    const d = await emit()
    await vi.waitFor(() => expect(bus.lastSeen).toBe(d))

    const page = await bus.replay({
      since: a,
      upTo: d,
      topics: [`profile:${profileId}`],
      limit: 10,
    })
    expect(page.map((e) => e.id)).toEqual([String(c), String(d)])
    const limited = await bus.replay({ since: 0, upTo: d, topics: ['profile:*'], limit: 2 })
    expect(limited).toHaveLength(2)
  })

  it('stop() closes the listen connection and cancels a pending reconnect', async () => {
    const { bus, src, timers } = await setup()
    await bus.start()
    await src.drop()
    expect(timers.pending).toHaveLength(1)
    await bus.stop()
    expect(timers.pending).toHaveLength(0)
    expect(bus.status).toBe('stopped')
    timers.advance(60_000)
    expect(src.connects).toBe(1)
  })
})
