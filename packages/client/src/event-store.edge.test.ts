import { newId } from '@faire/contracts'
import { ORPCError } from '@orpc/client'
import { QueryObserver } from '@tanstack/query-core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventStore, type EventsApi } from './event-store.ts'
import { fakeEvents, keyUtils, newQueryClient, wire } from './test-util.ts'

const runA = newId('run')
const runB = newId('run')
const notify = { title: 't', body: 'b', level: 'info' }

describe('event store edge cases', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  function setup(over: { random?: () => number; onError?: (n: string) => void } = {}) {
    const events = fakeEvents()
    const queryClient = newQueryClient()
    const utils = keyUtils()
    const store = createEventStore({
      events: events.api,
      queryClient,
      utils,
      random: over.random ?? (() => 1),
      ...(over.onError ? { onError: over.onError } : {}),
    })
    return { ...events, queryClient, utils, store }
  }
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

  it('start() twice opens one subscription', async () => {
    const { store, streams } = setup()
    store.start()
    store.start()
    await tick()
    expect(streams).toHaveLength(1)
    store.stop()
  })

  it('keeps two interleaved runs apart, each with its own step reset', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    const s = streams[0]
    s?.push(wire('run.delta', { text: 'A0 ', stepIdx: 0 }, { runId: runA }))
    s?.push(wire('run.delta', { text: 'B0 ', stepIdx: 0 }, { runId: runB }))
    s?.push(wire('run.delta', { text: 'A0b', stepIdx: 0 }, { runId: runA }))
    s?.push(wire('run.delta', { text: 'B1', stepIdx: 1 }, { runId: runB }))
    await tick()
    expect(store.getRunText(runA)).toBe('A0 A0b')
    expect(store.getRunText(runB)).toBe('B1')
    s?.push(wire('run.status', { status: 'succeeded' }, { runId: runA }))
    await tick()
    expect(store.getRunText(runA)).toBe('')
    expect(store.getRunText(runB)).toBe('B1')
    store.stop()
  })

  it('treats a missing stepIdx as step 0', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'a' }, { runId: runA }))
    streams[0]?.push(wire('run.delta', { text: 'b', stepIdx: 0 }, { runId: runA }))
    await tick()
    expect(store.getRunText(runA)).toBe('ab')
    store.stop()
  })

  it('keeps unicode text intact across deltas', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'héllo 🦊 ', stepIdx: 0 }, { runId: runA }))
    streams[0]?.push(wire('run.delta', { text: '日本語', stepIdx: 0 }, { runId: runA }))
    await tick()
    expect(store.getRunText(runA)).toBe('héllo 🦊 日本語')
    store.stop()
  })

  it('survives a malformed known-type envelope mid-stream and still moves the cursor', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    const s = streams[0]
    s?.push(wire('run.delta', { text: 'ok ', stepIdx: 0 }, { id: 1, runId: runA }))
    s?.push(wire('run.delta', { text: 42, stepIdx: 0 }, { id: 2, runId: runA }))
    s?.push(wire('run.delta', { text: 'more', stepIdx: 0 }, { id: 3, runId: runA }))
    await tick()
    expect(store.getRunText(runA)).toBe('ok more')
    expect(store.cursor).toBe('3')
    expect(store.status).toBe('live')
    store.stop()
  })

  it('skips an envelope from a newer wire version and moves past it', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('notify', notify, { id: 9, v: 2 }))
    await tick()
    expect(store.cursor).toBe('9')
    store.stop()
  })

  it('does not resurrect a pre-resync cursor when the stream drops again after a resync', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('notify', notify, { id: 50 }))
    await tick()
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(2)
    // The resubscribed stream dies before any event: the retry stays live-only.
    streams[1]?.fail(new Error('socket closed'))
    await tick(1000)
    expect(streams).toHaveLength(3)
    expect(streams[2]?.input).toEqual({ topics: ['profile:*'] })
    store.stop()
  })

  it('handles RESYNC_REQUIRED thrown by subscribe itself', async () => {
    const { store, streams, failNextSubscribe, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    store.start()
    await tick()
    streams[0]?.push(wire('notify', notify, { id: 5 }))
    streams[0]?.end()
    await tick()
    failNextSubscribe(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick(1000)
    expect(invalidate).toHaveBeenCalledWith()
    expect(store.cursor).toBeUndefined()
    await tick(1000)
    expect(streams).toHaveLength(2)
    expect(streams[1]?.input).toEqual({ topics: ['profile:*'] })
    store.stop()
  })

  it('goes immediate again for a resync after an event has flowed since the last one', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(2)
    streams[1]?.push(wire('notify', notify))
    await tick()
    streams[1]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(3)
    store.stop()
  })

  it('caps the reconnect wait at 30 seconds', async () => {
    const { store, streams, failNextSubscribe } = setup()
    store.start()
    await tick()
    streams[0]?.end()
    await tick()
    for (const wait of [1000, 2000, 4000, 8000, 16_000]) {
      failNextSubscribe(new Error('refused'))
      await tick(wait)
    }
    expect(streams).toHaveLength(1)
    await tick(29_999)
    expect(streams).toHaveLength(1)
    await tick(1)
    expect(streams).toHaveLength(2)
    store.stop()
  })

  it('jitters the wait down to half the step', async () => {
    const { store, streams } = setup({ random: () => 0 })
    store.start()
    await tick()
    streams[0]?.end()
    await tick(499)
    expect(streams).toHaveLength(1)
    await tick(1)
    expect(streams).toHaveLength(2)
    store.stop()
  })

  it('stop() during backoff leaves no timer behind', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.end()
    await tick()
    expect(vi.getTimerCount()).toBeGreaterThan(0)
    store.stop()
    await tick()
    expect(vi.getTimerCount()).toBe(0)
    expect(store.status).toBe('stopped')
  })

  it('stop() while subscribe is still pending never goes live', async () => {
    let release: (() => void) | undefined
    let calls = 0
    const api: EventsApi = {
      async subscribe() {
        calls++
        await new Promise<void>((r) => {
          release = r
        })
        return (async function* () {})()
      },
    }
    const store = createEventStore({
      events: api,
      queryClient: newQueryClient(),
      utils: keyUtils(),
      random: () => 1,
    })
    store.start()
    await tick()
    store.stop()
    release?.()
    await tick(60_000)
    expect(store.status).toBe('stopped')
    expect(calls).toBe(1)
  })

  it('reports a failing stream by error name only, never its message', async () => {
    const onError = vi.fn()
    const { store, streams } = setup({ onError })
    store.start()
    await tick()
    streams[0]?.fail(new TypeError('secret token abc'))
    await tick()
    expect(onError).toHaveBeenCalledWith('TypeError')
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret')
    store.stop()
  })

  it('a throwing subscriber does not break the stream or other subscribers', async () => {
    const { store, streams } = setup()
    const seen: string[] = []
    store.subscribeRunText(runA, () => {
      throw new Error('boom')
    })
    store.subscribeRunText(runA, () => void seen.push(store.getRunText(runA)))
    store.subscribeStatus(() => {
      throw new Error('boom')
    })
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'x', stepIdx: 0 }, { runId: runA }))
    streams[0]?.push(wire('run.delta', { text: 'y', stepIdx: 0 }, { runId: runA }))
    await tick()
    expect(seen).toEqual(['x', 'xy'])
    expect(store.status).toBe('live')
    store.stop()
  })

  it('invalidates the approvals queries on approval events', async () => {
    const { store, streams, queryClient, utils } = setup()
    const key = utils.approvals.list.queryKey({ input: {} as never })
    queryClient.setQueryData(key, [] as never)
    store.start()
    await tick()
    streams[0]?.push(
      wire('approval.resolved', { approvalId: newId('approval'), status: 'approved' }),
    )
    await tick()
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    store.stop()
  })

  it('invalidates the thread queries when a step is stored', async () => {
    const { store, streams, queryClient, utils } = setup()
    const key = utils.threads.list.queryKey({ input: { profileId: newId('profile') } })
    queryClient.setQueryData(key, [] as never)
    store.start()
    await tick()
    streams[0]?.push(
      wire('run.step', { stepId: newId('step'), idx: 0, kind: 'model' }, { runId: runA }),
    )
    await tick()
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    store.stop()
  })

  it('keeps the streamed text until the refetched reply has landed', async () => {
    const { store, streams, queryClient, utils } = setup()
    const key = utils.threads.list.queryKey({ input: { profileId: newId('profile') } })
    let finish: (() => void) | undefined
    let fetches = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      queryFn: () => {
        fetches++
        if (fetches === 1) return Promise.resolve([])
        return new Promise<never[]>((resolve) => {
          finish = () => resolve([])
        })
      },
    })
    const unsubscribe = observer.subscribe(() => {})
    await tick()
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'draft', stepIdx: 0 }, { runId: runA }))
    streams[0]?.push(wire('run.status', { status: 'succeeded' }, { runId: runA }))
    await tick()
    expect(fetches).toBe(2)
    expect(store.getRunText(runA)).toBe('draft')
    finish?.()
    await tick()
    expect(store.getRunText(runA)).toBe('')
    unsubscribe()
    store.stop()
  })

  it('drops the text even when the refetch fails', async () => {
    const { store, streams, queryClient, utils } = setup()
    const key = utils.threads.list.queryKey({ input: { profileId: newId('profile') } })
    let fetches = 0
    const observer = new QueryObserver(queryClient, {
      queryKey: key,
      retry: false,
      queryFn: () => {
        fetches++
        return fetches === 1 ? Promise.resolve([]) : Promise.reject(new Error('offline'))
      },
    })
    const unsubscribe = observer.subscribe(() => {})
    await tick()
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'draft', stepIdx: 0 }, { runId: runA }))
    streams[0]?.push(wire('run.status', { status: 'failed' }, { runId: runA }))
    await tick()
    expect(store.getRunText(runA)).toBe('')
    unsubscribe()
    store.stop()
  })
})
