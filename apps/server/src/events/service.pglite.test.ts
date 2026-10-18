import type { LenientEnvelope, ProfileId, Topic } from '@faire/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { insertEvent } from '../runs/repo.ts'
import { seedProfile, seedRun } from '../runs/test-util.ts'
import { createEventBus } from './bus.ts'
import {
  createEventsService,
  newConnectionState,
  ResyncRequiredError,
  TooManySubscriptionsError,
} from './service.ts'
import { pgliteDb, pgliteSource } from './test-util.ts'

const payload = { title: 't', body: 'b', level: 'info' as const }

describe('events service on PGlite', () => {
  const cleanup: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  async function setup(over: { maxQueue?: number; maxPerConnection?: number; page?: number } = {}) {
    const env = await pgliteDb()
    cleanup.push(env.close)
    const bus = createEventBus({
      db: env.db,
      source: pgliteSource(env.client).source,
      logger: createLogger({ level: 'silent' }),
    })
    const profileId = await seedProfile(env.db)
    const other = await seedProfile(env.db)
    const emit = async (
      p: ProfileId = profileId,
      runId: Parameters<typeof insertEvent>[1]['runId'] = null,
    ) => {
      const id = await insertEvent(env.db, { profileId: p, runId, type: 'notify', payload })
      await vi.waitFor(() => expect(bus.lastSeen).toBe(id))
      return id
    }
    const service = createEventsService({
      bus,
      ...(over.maxQueue ? { maxQueue: over.maxQueue } : {}),
      ...(over.maxPerConnection ? { maxPerConnection: over.maxPerConnection } : {}),
      ...(over.page ? { replayPageSize: over.page } : {}),
    })
    cleanup.push(() => bus.stop())
    await bus.start()
    const open = (
      topics: Topic[],
      since?: string,
      conn = newConnectionState(),
      signal?: AbortSignal,
    ) => {
      // Aborting is how the transport ends a stream: return() would queue behind a pending next().
      const ctl = new AbortController()
      const it = service.subscribe(
        { topics, ...(since === undefined ? {} : { since }) },
        { connection: conn, signal: signal ?? ctl.signal },
      )
      cleanup.push(async () => ctl.abort())
      return it
    }
    const take = async (it: AsyncGenerator<LenientEnvelope>, n: number) => {
      const out: LenientEnvelope[] = []
      while (out.length < n) {
        const r = await it.next()
        if (r.done) break
        out.push(r.value)
      }
      return out
    }
    return { env, bus, profileId, other, emit, open, take }
  }

  it('without since it streams only what happens after subscribing, for the topic only', async () => {
    const { profileId, other, emit, open, take } = await setup()
    await emit()
    const it = open([`profile:${profileId}`])
    const pending = take(it, 1)
    await emit(other)
    const live = await emit()
    expect((await pending).map((e) => e.id)).toEqual([String(live)])
  })

  it('with since it replays missed events then continues live, each exactly once', async () => {
    const { profileId, emit, open, take } = await setup()
    const first = await emit()
    const second = await emit()
    const third = await emit()
    const it = open([`profile:${profileId}`], String(first))
    const got = await take(it, 2)
    expect(got.map((e) => e.id)).toEqual([String(second), String(third)])
    const next = take(it, 1)
    const fourth = await emit()
    expect((await next).map((e) => e.id)).toEqual([String(fourth)])
  })

  it('events committed while the replay is still paging are neither lost nor repeated', async () => {
    const { profileId, emit, open, take } = await setup({ page: 2 })
    const base = await emit()
    const old = [await emit(), await emit(), await emit(), await emit(), await emit()]
    const it = open([`profile:${profileId}`], String(base))
    const head = await take(it, 1) // replay started, more pages to go
    const during = [await emit(), await emit()]
    const rest = await take(it, old.length - 1 + during.length)
    const ids = [...head, ...rest].map((e) => Number(e.id))
    expect(ids).toEqual([...old, ...during])
  })

  it('replays only the events of a run topic', async () => {
    const { env, profileId, emit, open, take } = await setup()
    const runId = await seedRun(env.db, profileId)
    await emit(profileId)
    const match = await emit(profileId, runId)
    const it = open([`run:${runId}`], '0')
    expect((await take(it, 1)).map((e) => e.id)).toEqual([String(match)])
  })

  it('delivers run deltas live to matching topics and never replays them', async () => {
    const { bus, profileId, env, emit, open, take } = await setup()
    const runId = await seedRun(env.db, profileId)
    const id = await emit(profileId, runId)
    const it = open([`run:${runId}`], '0')
    expect((await take(it, 1)).map((e) => e.id)).toEqual([String(id)])
    const next = take(it, 1)
    bus.publishEphemeral({ profileId, runId, type: 'run.delta', payload: { text: 'hi' } })
    const [delta] = await next
    expect(delta).toMatchObject({ type: 'run.delta', id: String(id), runId })
    // A delta whose id equals the last persisted id still arrives: ephemeral ids are not unique.
    const again = take(it, 1)
    bus.publishEphemeral({ profileId, runId, type: 'run.delta', payload: { text: 'more' } })
    expect((await again)[0]?.payload).toEqual({ text: 'more' })
  })

  it('a since beyond the newest event just goes live', async () => {
    const { profileId, emit, open, take } = await setup()
    await emit()
    const it = open([`profile:${profileId}`], '999999')
    const next = take(it, 1)
    const id = await emit()
    expect((await next).map((e) => e.id)).toEqual([String(id)])
  })

  it('ends with RESYNC_REQUIRED when the consumer falls too far behind', async () => {
    const { profileId, emit, open, bus } = await setup({ maxQueue: 3 })
    const it = open([`profile:${profileId}`])
    const first = it.next() // attaches the listener, then waits
    await vi.waitFor(() => expect(bus.listenerCount).toBe(1))
    const a = await emit()
    await first
    // The consumer now stops reading while five more events arrive.
    for (let i = 0; i < 5; i++) await emit()
    await expect(it.next()).rejects.toBeInstanceOf(ResyncRequiredError)
    expect(a).toBeGreaterThan(0)
    expect(bus.listenerCount).toBe(0)
  })

  it('rejects a subscription beyond the per-connection cap and frees the slot on close', async () => {
    const { profileId, open, bus } = await setup({ maxPerConnection: 2 })
    const conn = newConnectionState()
    const stopA = new AbortController()
    const a = open([`profile:${profileId}`], undefined, conn, stopA.signal)
    const b = open([`profile:${profileId}`], undefined, conn)
    void a.next()
    void b.next()
    await vi.waitFor(() => expect(bus.listenerCount).toBe(2))
    await expect(open([`profile:${profileId}`], undefined, conn).next()).rejects.toBeInstanceOf(
      TooManySubscriptionsError,
    )
    stopA.abort()
    await vi.waitFor(() => expect(conn.subscriptions).toBe(1))
    const c = open([`profile:${profileId}`], undefined, conn)
    void c.next()
    await vi.waitFor(() => expect(bus.listenerCount).toBe(2))
    // Another connection has its own budget.
    const d = open([`profile:${profileId}`])
    void d.next()
    await vi.waitFor(() => expect(bus.listenerCount).toBe(3))
  })

  it('an aborted signal ends the stream and removes the listener', async () => {
    const { profileId, open, bus } = await setup()
    const ctl = new AbortController()
    const it = open([`profile:${profileId}`], undefined, newConnectionState(), ctl.signal)
    const pending = it.next()
    await vi.waitFor(() => expect(bus.listenerCount).toBe(1))
    ctl.abort()
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(bus.listenerCount).toBe(0)
  })

  it('a signal that is already aborted never attaches', async () => {
    const { profileId, open, bus } = await setup()
    const ctl = new AbortController()
    ctl.abort()
    const it = open([`profile:${profileId}`], undefined, newConnectionState(), ctl.signal)
    expect(await it.next()).toEqual({ done: true, value: undefined })
    expect(bus.listenerCount).toBe(0)
  })
})
