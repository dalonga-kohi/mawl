import type { LenientEnvelope, Topic } from '@faire/contracts'
import type { EventBus } from './bus.ts'
import { topicFilter } from './topics.ts'

export const DEFAULT_MAX_QUEUE = 1000
export const DEFAULT_MAX_PER_CONNECTION = 20
export const DEFAULT_REPLAY_PAGE_SIZE = 500

/** The subscriber fell too far behind. The client invalidates its caches and resubscribes without `since`. */
export class ResyncRequiredError extends Error {
  constructor() {
    super('Event stream overflowed; invalidate caches and resubscribe without since')
    this.name = 'ResyncRequiredError'
  }
}

/** The connection already holds the maximum number of subscriptions. */
export class TooManySubscriptionsError extends Error {
  constructor() {
    super('Too many concurrent subscriptions on this connection')
    this.name = 'TooManySubscriptionsError'
  }
}

/** Per-connection bookkeeping. A WebSocket connection owns one; an HTTP request gets a fresh one. */
export interface ConnectionState {
  subscriptions: number
}

export const newConnectionState = (): ConnectionState => ({ subscriptions: 0 })

/**
 * A bounded buffer between the bus (which must never wait) and one slow consumer. Overflow drops
 * the buffer and fails the consumer's next read.
 */
class EventQueue {
  private items: LenientEnvelope[] = []
  private waiter: (() => void) | undefined
  private overflowed = false
  private closed = false

  constructor(private readonly max: number) {}

  push(event: LenientEnvelope): void {
    if (this.closed || this.overflowed) return
    if (this.items.length >= this.max) {
      this.overflowed = true
      this.items = []
    } else {
      this.items.push(event)
    }
    this.wake()
  }

  close(): void {
    this.closed = true
    this.wake()
  }

  get isClosed(): boolean {
    return this.closed
  }

  throwIfOverflowed(): void {
    if (this.overflowed) throw new ResyncRequiredError()
  }

  /** The next event, or undefined once closed. */
  async next(): Promise<LenientEnvelope | undefined> {
    for (;;) {
      this.throwIfOverflowed()
      const item = this.items.shift()
      if (item) return item
      if (this.closed) return undefined
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }

  private wake(): void {
    const w = this.waiter
    this.waiter = undefined
    w?.()
  }
}

export interface EventsServiceOptions {
  bus: EventBus
  maxQueue?: number
  maxPerConnection?: number
  replayPageSize?: number
}

export interface SubscribeContext {
  connection: ConnectionState
  /** Aborted when the client goes away. */
  signal?: AbortSignal
}

export interface EventsService {
  /**
   * Replay (when `since` is given), then live. The live listener attaches first and the replay
   * stops at the bus's high-water mark of that moment, so nothing falls between the two and the
   * buffered live events are all newer than the replayed ones.
   */
  subscribe(
    input: { topics: readonly Topic[]; since?: string | undefined },
    context: SubscribeContext,
  ): AsyncGenerator<LenientEnvelope, void, undefined>
}

export function createEventsService(options: EventsServiceOptions): EventsService {
  const { bus } = options
  const maxQueue = options.maxQueue ?? DEFAULT_MAX_QUEUE
  const maxPerConnection = options.maxPerConnection ?? DEFAULT_MAX_PER_CONNECTION
  const pageSize = options.replayPageSize ?? DEFAULT_REPLAY_PAGE_SIZE

  return {
    async *subscribe(input, { connection, signal }) {
      if (signal?.aborted) return
      if (connection.subscriptions >= maxPerConnection) throw new TooManySubscriptionsError()
      connection.subscriptions++
      const queue = new EventQueue(maxQueue)
      const matches = topicFilter(input.topics)
      const detach = bus.subscribe((event) => {
        if (matches(event)) queue.push(event)
      })
      const onAbort = () => queue.close()
      signal?.addEventListener('abort', onAbort, { once: true })
      try {
        // Same tick as the attach: every event the bus dispatches from here on has id > high.
        const high = bus.lastSeen
        let lastSent = high
        if (input.since !== undefined) {
          lastSent = Math.min(Number(input.since), high)
          for (;;) {
            if (queue.isClosed) return
            queue.throwIfOverflowed()
            const page = await bus.replay({
              since: lastSent,
              upTo: high,
              topics: input.topics,
              limit: pageSize,
            })
            for (const event of page) {
              lastSent = Number(event.id)
              yield event
            }
            if (page.length < pageSize) break
          }
        }
        for (;;) {
          const event = await queue.next()
          if (!event) return
          if (event.type !== 'run.delta') {
            // Persisted: ids only grow, so anything at or below what was sent is a repeat.
            if (Number(event.id) <= lastSent) continue
            lastSent = Number(event.id)
          }
          yield event
        }
      } finally {
        detach()
        signal?.removeEventListener('abort', onAbort)
        queue.close()
        connection.subscriptions--
      }
    },
  }
}
