import {
  type Envelope,
  type LenientEnvelope,
  parseEnvelope,
  RUN_TERMINAL_STATUSES,
  type RunId,
  type Topic,
} from '@faire/contracts'
import { ORPCError } from '@orpc/client'
import type { QueryClient } from '@tanstack/query-core'
import type { FaireQueryUtils } from './client.ts'

export interface EventsSubscribeInput {
  topics: Topic[]
  since?: string
}

/** The slice of `client.events` the store needs. Tests replace it by a hand-driven stream. */
export interface EventsApi {
  subscribe(
    input: EventsSubscribeInput,
    options?: { signal?: AbortSignal },
  ): Promise<AsyncIterable<LenientEnvelope>>
}

export type EventStoreStatus = 'idle' | 'live' | 'reconnecting' | 'stopped'

export interface EventStoreOptions {
  events: EventsApi
  queryClient: QueryClient
  /** Builds the query keys to invalidate. */
  utils: FaireQueryUtils
  /** Defaults to every profile. */
  topics?: Topic[]
  /** For backoff jitter, in [0, 1). Defaults to Math.random. */
  random?: () => number
  /** Called with the error name when a stream fails. Never receives message text. */
  onError?: (errName: string) => void
}

export interface EventStore {
  /** Opens the subscription and keeps it open, reconnecting with backoff. Safe to call twice. */
  start(): void
  /** Closes the subscription and stops reconnecting. `start()` may be called again. */
  stop(): void
  readonly status: EventStoreStatus
  /** Id of the newest event seen, as a decimal string. Undefined before the first event or after a resync. */
  readonly cursor: string | undefined
  /** Text streamed so far for a run's current step; '' when none. A stable snapshot for `useSyncExternalStore`. */
  getRunText(runId: RunId): string
  subscribeRunText(runId: RunId, listener: () => void): () => void
  subscribeStatus(listener: () => void): () => void
}

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30_000
const DEFAULT_TOPICS: Topic[] = ['profile:*']
const TERMINAL: readonly string[] = RUN_TERMINAL_STATUSES

/** Exponential wait with jitter between half and the whole of the step; `attempt` starts at 0. */
function backoff(attempt: number, random: () => number): number {
  const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt)
  return Math.round(step * (0.5 + random() / 2))
}

const isResync = (err: unknown) => err instanceof ORPCError && err.code === 'RESYNC_REQUIRED'

/** Resolves after `ms`, or at once when the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Keeps one `events.subscribe` stream alive and turns it into UI state: stored events invalidate
 * the TanStack Query entries they change, and `run.delta` text lands in a per-run buffer. Every
 * item goes through `parseEnvelope`, so an event type from a newer server is skipped, yet the
 * cursor still moves past it.
 */
export function createEventStore(options: EventStoreOptions): EventStore {
  const { events, queryClient, utils } = options
  const topics = options.topics ?? DEFAULT_TOPICS
  const random = options.random ?? Math.random

  let status: EventStoreStatus = 'idle'
  let cursor: bigint | undefined
  let session: AbortController | undefined
  const runText = new Map<RunId, { stepIdx: number; text: string }>()
  const textListeners = new Map<RunId, Set<() => void>>()
  const statusListeners = new Set<() => void>()

  const call = (fn: () => void) => {
    try {
      fn()
    } catch {
      // A throwing subscriber must not break the stream.
    }
  }
  const setStatus = (next: EventStoreStatus) => {
    if (status === next) return
    status = next
    for (const l of [...statusListeners]) call(l)
  }
  const notifyText = (runId: RunId) => {
    for (const l of [...(textListeners.get(runId) ?? [])]) call(l)
  }

  function advance(id: string | undefined) {
    if (id === undefined) return
    const next = BigInt(id)
    if (cursor === undefined || next > cursor) cursor = next
  }

  function apply(event: Envelope): void {
    switch (event.type) {
      case 'run.delta': {
        if (!event.runId) return
        const stepIdx = event.payload.stepIdx ?? 0
        const current = runText.get(event.runId)
        const text = current && current.stepIdx === stepIdx ? current.text : ''
        runText.set(event.runId, { stepIdx, text: text + event.payload.text })
        notifyText(event.runId)
        return
      }
      case 'run.status': {
        const runId = event.runId
        const done = TERMINAL.includes(event.payload.status)
        const pending = [queryClient.invalidateQueries({ queryKey: utils.runs.key() })]
        if (done) pending.push(queryClient.invalidateQueries({ queryKey: utils.threads.key() }))
        if (done && runId) {
          // The stored reply replaces the streamed text only once it has been fetched.
          void Promise.allSettled(pending).then(() => {
            if (runText.delete(runId)) notifyText(runId)
          })
        }
        return
      }
      case 'run.step':
        void queryClient.invalidateQueries({ queryKey: utils.threads.key() })
        return
      case 'approval.created':
      case 'approval.resolved':
        void queryClient.invalidateQueries({ queryKey: utils.approvals.key() })
        return
      default:
        return
    }
  }

  function handle(raw: unknown): void {
    const parsed = parseEnvelope(raw)
    if (parsed.ok) {
      advance(parsed.event.id)
      apply(parsed.event)
    } else {
      advance(parsed.id)
    }
  }

  /** Reads one subscription until it ends, fails, or the session is stopped. */
  async function readStream(
    signal: AbortSignal,
    on: { open(): void; item(): void },
  ): Promise<void> {
    const stream = await events.subscribe(
      { topics, ...(cursor !== undefined ? { since: String(cursor) } : {}) },
      { signal },
    )
    if (signal.aborted) return
    on.open()
    const iterator = stream[Symbol.asyncIterator]()
    let onAbort = () => {}
    const aborted = new Promise<'aborted'>((resolve) => {
      onAbort = () => resolve('aborted')
      signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
      for (;;) {
        const step = await Promise.race([iterator.next(), aborted])
        if (step === 'aborted' || step.done) return
        on.item()
        handle(step.value)
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      await iterator.return?.().catch(() => {})
    }
  }

  async function run(signal: AbortSignal): Promise<void> {
    let attempt = 0
    let resyncs = 0
    while (!signal.aborted) {
      let delay: number | undefined
      try {
        await readStream(signal, {
          open() {
            attempt = 0
            setStatus('live')
          },
          item: () => {
            resyncs = 0
          },
        })
      } catch (err) {
        if (signal.aborted) return
        if (isResync(err)) {
          // Missed events cannot be replayed: refetch everything and follow the stream from now.
          cursor = undefined
          void queryClient.invalidateQueries()
          const n = resyncs++
          delay = n === 0 ? 0 : backoff(n - 1, random)
        } else {
          options.onError?.(err instanceof Error ? err.name : 'unknown')
        }
      }
      if (signal.aborted) return
      setStatus('reconnecting')
      await sleep(delay ?? backoff(attempt++, random), signal)
    }
  }

  return {
    start() {
      if (session) return
      const controller = new AbortController()
      session = controller
      void run(controller.signal).finally(() => {
        if (session === controller) session = undefined
      })
    },
    stop() {
      session?.abort()
      session = undefined
      setStatus('stopped')
    },
    get status() {
      return status
    },
    get cursor() {
      return cursor === undefined ? undefined : String(cursor)
    },
    getRunText: (runId) => runText.get(runId)?.text ?? '',
    subscribeRunText(runId, listener) {
      const set = textListeners.get(runId) ?? new Set<() => void>()
      textListeners.set(runId, set)
      set.add(listener)
      return () => {
        set.delete(listener)
        if (set.size === 0) textListeners.delete(runId)
      }
    },
    subscribeStatus(listener) {
      statusListeners.add(listener)
      return () => void statusListeners.delete(listener)
    },
  }
}
