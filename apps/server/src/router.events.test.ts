import { type LenientEnvelope, newId } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import {
  type ConnectionState,
  type EventsService,
  newConnectionState,
  ResyncRequiredError,
  TooManySubscriptionsError,
} from './events/service.ts'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { unusedRuns } from './runs/test-util.ts'

const profileId = newId('profile')
const envelope: LenientEnvelope = {
  v: 1,
  id: '7',
  type: 'notify',
  profileId,
  ts: '2026-01-01T00:00:00.000Z',
  payload: { title: 't', body: 'b', level: 'info' },
}

const routerWith = (events?: EventsService) =>
  createRouter({
    version: '1',
    providers: unusedProviders,
    runs: unusedRuns,
    ...(events ? { events } : {}),
  })

async function collect(it: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const item of it) out.push(item)
  return out
}

describe('events.subscribe', () => {
  it('streams what the events service yields and passes input, connection and signal along', async () => {
    const seen: { connection: ConnectionState; signal: AbortSignal | undefined }[] = []
    const events: EventsService = {
      async *subscribe(input, ctx) {
        seen.push({ connection: ctx.connection, signal: ctx.signal })
        expect(input).toEqual({ topics: ['profile:*'], since: '5' })
        yield envelope
      },
    }
    const connection = newConnectionState()
    const ctl = new AbortController()
    const stream = await call(
      routerWith(events).events.subscribe,
      { topics: ['profile:*'], since: '5' },
      { context: { connection }, signal: ctl.signal },
    )
    expect(await collect(stream)).toEqual([envelope])
    expect(seen[0]?.connection).toBe(connection)
    expect(seen[0]?.signal).toBe(ctl.signal)
  })

  it('uses a fresh connection state when the transport has none (HTTP)', async () => {
    const subscribe = vi.fn(async function* () {})
    const stream = await call(routerWith({ subscribe }).events.subscribe, { topics: ['profile:*'] })
    await collect(stream)
    expect(subscribe.mock.calls[0]).toBeDefined()
  })

  it('maps an overflowed stream to the typed RESYNC_REQUIRED error', async () => {
    const events: EventsService = {
      async *subscribe() {
        yield envelope
        throw new ResyncRequiredError()
      },
    }
    const stream = await call(routerWith(events).events.subscribe, { topics: ['profile:*'] })
    await expect(collect(stream)).rejects.toMatchObject({ code: 'RESYNC_REQUIRED', status: 409 })
  })

  it('maps the connection cap to the typed TOO_MANY_SUBSCRIPTIONS error', async () => {
    const events: EventsService = {
      // biome-ignore lint/correctness/useYield: throws before the first item on purpose
      async *subscribe() {
        throw new TooManySubscriptionsError()
      },
    }
    const stream = await call(routerWith(events).events.subscribe, { topics: ['profile:*'] })
    await expect(collect(stream)).rejects.toMatchObject({
      code: 'TOO_MANY_SUBSCRIPTIONS',
      status: 429,
    })
  })

  it('lets unexpected errors through unchanged', async () => {
    const events: EventsService = {
      // biome-ignore lint/correctness/useYield: throws before the first item on purpose
      async *subscribe() {
        throw new Error('db down')
      },
    }
    const stream = await call(routerWith(events).events.subscribe, { topics: ['profile:*'] })
    await expect(collect(stream)).rejects.toThrow('db down')
  })

  it('stays a 501 stub when the server was built without an events service', async () => {
    await expect(
      call(routerWith().events.subscribe, { topics: ['profile:*'] }),
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' })
  })
})
