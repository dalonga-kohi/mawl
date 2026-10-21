import { newId } from '@mawl/contracts'
import { ORPCError } from '@orpc/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventStore } from './event-store.ts'
import { fakeEvents, keyUtils, newQueryClient, wire } from './test-util.ts'

const runId = newId('run')
const otherRun = newId('run')

describe('event store', () => {
  beforeEach(() => void vi.useFakeTimers())
  afterEach(() => void vi.useRealTimers())

  function setup(over: { random?: () => number } = {}) {
    const events = fakeEvents()
    const queryClient = newQueryClient()
    const utils = keyUtils()
    const store = createEventStore({
      events: events.api,
      queryClient,
      utils,
      random: over.random ?? (() => 1),
    })
    return { ...events, queryClient, utils, store }
  }
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

  it('subscribes to every profile without a cursor on first start', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    expect(streams).toHaveLength(1)
    expect(streams[0]?.input).toEqual({ topics: ['profile:*'] })
    expect(store.status).toBe('live')
    store.stop()
  })

  it('resumes from the last event id after the stream drops, waiting out the backoff', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('notify', { title: 't', body: 'b', level: 'info' }, { id: 41 }))
    streams[0]?.push(wire('notify', { title: 't', body: 'b', level: 'info' }, { id: 42 }))
    await tick()
    expect(store.cursor).toBe('42')

    streams[0]?.fail(new Error('socket closed'))
    await tick()
    expect(store.status).toBe('reconnecting')
    expect(streams).toHaveLength(1)
    await tick(999)
    expect(streams).toHaveLength(1)
    await tick(1)
    expect(streams).toHaveLength(2)
    expect(streams[1]?.input).toEqual({ topics: ['profile:*'], since: '42' })
    store.stop()
  })

  it('doubles the wait for each failed attempt and resets once an event arrives', async () => {
    const { store, streams, failNextSubscribe } = setup()
    store.start()
    await tick()
    streams[0]?.end()
    await tick()
    failNextSubscribe(new Error('refused'))
    await tick(1000)
    expect(streams).toHaveLength(1)
    await tick(1999)
    expect(streams).toHaveLength(1)
    await tick(1)
    expect(streams).toHaveLength(2)
    // An event arrived, so the next drop starts again at the base wait.
    streams[1]?.push(wire('notify', { title: 't', body: 'b', level: 'info' }))
    await tick()
    streams[1]?.end()
    await tick(1000)
    expect(streams).toHaveLength(3)
    store.stop()
  })

  it('skips an unknown event type but still moves the cursor past it', async () => {
    const { store, streams, queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    store.start()
    await tick()
    streams[0]?.push(wire('hologram.projected', { x: 1 }, { id: 7 }))
    streams[0]?.push({ garbage: true })
    await tick()
    expect(store.cursor).toBe('7')
    expect(invalidate).not.toHaveBeenCalled()
    store.stop()
  })

  it('never moves the cursor backwards: a delta carries the newest stored id', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('run.status', { status: 'running' }, { id: 10, runId }))
    streams[0]?.push(wire('run.delta', { text: 'a', stepIdx: 0 }, { id: 9, runId }))
    await tick()
    expect(store.cursor).toBe('10')
    store.stop()
  })

  it('buffers run text per run and tells subscribers', async () => {
    const { store, streams } = setup()
    const seen: string[] = []
    const off = store.subscribeRunText(runId, () => void seen.push(store.getRunText(runId)))
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'Hel', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.delta', { text: 'lo', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.delta', { text: 'other', stepIdx: 0 }, { runId: otherRun }))
    await tick()
    expect(store.getRunText(runId)).toBe('Hello')
    expect(store.getRunText(otherRun)).toBe('other')
    expect(seen).toEqual(['Hel', 'Hello'])
    off()
    streams[0]?.push(wire('run.delta', { text: '!', stepIdx: 0 }, { runId }))
    await tick()
    expect(seen).toEqual(['Hel', 'Hello'])
    expect(store.getRunText(runId)).toBe('Hello!')
    store.stop()
  })

  it('starts the buffer over when a later step begins to stream', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'Looking it up', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.delta', { text: 'The answer', stepIdx: 2 }, { runId }))
    await tick()
    expect(store.getRunText(runId)).toBe('The answer')
    store.stop()
  })

  it('invalidates the run and thread queries on a terminal status, then drops the run text', async () => {
    const { store, streams, queryClient, utils } = setup()
    const runKey = utils.runs.get.queryKey({ input: { id: runId } })
    const threadKey = utils.threads.messages.queryKey({
      input: { threadId: newId('thread') },
    })
    queryClient.setQueryData(runKey, { id: runId } as never)
    queryClient.setQueryData(threadKey, [] as never)
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'done', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.status', { status: 'succeeded' }, { runId }))
    await tick()
    expect(queryClient.getQueryState(runKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(true)
    expect(store.getRunText(runId)).toBe('')
    store.stop()
  })

  it('keeps the run text while the run is still going', async () => {
    const { store, streams, queryClient, utils } = setup()
    const threadKey = utils.threads.list.queryKey({ input: { profileId: newId('profile') } })
    queryClient.setQueryData(threadKey, [] as never)
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'partial', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.status', { status: 'running' }, { runId }))
    await tick()
    expect(store.getRunText(runId)).toBe('partial')
    expect(queryClient.getQueryState(threadKey)?.isInvalidated).toBe(false)
    store.stop()
  })

  it('on RESYNC_REQUIRED invalidates every query and resubscribes from now, without a cursor', async () => {
    const { store, streams, queryClient, utils } = setup()
    const key = utils.runs.get.queryKey({ input: { id: runId } })
    queryClient.setQueryData(key, { id: runId } as never)
    store.start()
    await tick()
    streams[0]?.push(wire('notify', { title: 't', body: 'b', level: 'info' }, { id: 50 }))
    await tick()
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    // The first resync retries at once.
    expect(streams).toHaveLength(2)
    expect(streams[1]?.input).toEqual({ topics: ['profile:*'] })
    expect(store.cursor).toBeUndefined()
    store.stop()
  })

  it('backs off when resyncs keep coming without any event in between', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(2)
    streams[1]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(2)
    await tick(1000)
    expect(streams).toHaveLength(3)
    store.stop()
  })

  it('stop() aborts the open stream, ends the iterator and never reconnects', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    store.stop()
    await tick()
    expect(streams[0]?.signal.aborted).toBe(true)
    expect(streams[0]?.returned).toBe(true)
    expect(store.status).toBe('stopped')
    await tick(60_000)
    expect(streams).toHaveLength(1)
  })

  it('stop() during a backoff cancels the reconnect', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.end()
    await tick()
    store.stop()
    await tick(60_000)
    expect(streams).toHaveLength(1)
  })

  it('can start again after stop and resumes from the cursor', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.push(wire('notify', { title: 't', body: 'b', level: 'info' }, { id: 5 }))
    await tick()
    store.stop()
    await tick()
    store.start()
    await tick()
    expect(streams[1]?.input).toEqual({ topics: ['profile:*'], since: '5' })
    store.stop()
  })
  it('keeps growing the wait while streams open and fail at once, without an event in between', async () => {
    const { store, streams } = setup()
    store.start()
    await tick()
    streams[0]?.fail(new Error('closed'))
    await tick(1000)
    expect(streams).toHaveLength(2)
    streams[1]?.fail(new Error('closed'))
    await tick(1999)
    expect(streams).toHaveLength(2)
    await tick(1)
    expect(streams).toHaveLength(3)
    streams[2]?.fail(new Error('closed'))
    await tick(3999)
    expect(streams).toHaveLength(3)
    await tick(1)
    expect(streams).toHaveLength(4)
    store.stop()
  })

  it('invalidates after the new stream is attached, so nothing between refetch and attach is lost', async () => {
    const { store, streams, queryClient } = setup()
    const attachedAtInvalidate: number[] = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(async () => {
      attachedAtInvalidate.push(streams.length)
    })
    store.start()
    await tick()
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(streams).toHaveLength(2)
    expect(attachedAtInvalidate).toEqual([2])
    store.stop()
  })

  it('drops every run text buffer on RESYNC_REQUIRED and tells the subscribers', async () => {
    const { store, streams } = setup()
    let calls = 0
    store.subscribeRunText(runId, () => void calls++)
    store.start()
    await tick()
    streams[0]?.push(wire('run.delta', { text: 'half a reply', stepIdx: 0 }, { runId }))
    streams[0]?.push(wire('run.delta', { text: 'x', stepIdx: 0 }, { runId: otherRun }))
    await tick()
    expect(calls).toBe(1)
    streams[0]?.fail(new ORPCError('RESYNC_REQUIRED', { status: 409 }))
    await tick()
    expect(store.getRunText(runId)).toBe('')
    expect(store.getRunText(otherRun)).toBe('')
    expect(calls).toBe(2)
    store.stop()
  })
})
