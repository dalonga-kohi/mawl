import {
  ENVELOPE_VERSION,
  type EventType,
  type LenientEnvelope,
  type ProfileId,
  type RunId,
  type Topic,
} from '@faire/contracts'
import { schema } from '@faire/db'
import { and, asc, gt, isNotNull, lte, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'
import type { NotificationConnection, NotificationSource } from './source.ts'
import { backoffDelay, realTimers, type TimerPort } from './timers.ts'
import { topicWhere } from './topics.ts'

const { events } = schema

export const DEFAULT_PAGE_SIZE = 500
/** How long events behind a hole in the id sequence wait for the hole to fill. */
export const DEFAULT_GAP_GRACE_MS = 2000
const GAP_RECHECK_MS = 250
const RETRY_DRAIN_MS = 1000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30_000

export type EventListener = (event: LenientEnvelope) => void

export interface EventBusOptions {
  db: ProvidersDb
  source: NotificationSource
  logger: Logger
  pageSize?: number
  gapGraceMs?: number
  timers?: TimerPort
  /** Milliseconds clock, for gap grace and delta timestamps. */
  now?: () => number
  random?: () => number
  /**
   * Runs just before a persisted event reaches the listeners. The delta coalescer flushes the
   * run's pending text here, so a delta never arrives after the step or status event that follows it.
   */
  beforePersisted?: (event: LenientEnvelope) => void
}

export interface EphemeralEvent {
  profileId: ProfileId
  runId?: RunId
  type: EventType
  payload: unknown
}

export interface ReplayQuery {
  /** Exclusive lower bound. */
  since: number
  /** Inclusive upper bound: the bus's `lastSeen` when the subscriber attached. */
  upTo: number
  topics: readonly Topic[]
  limit: number
}

export interface EventBus {
  /** Reads the current high-water mark, then LISTENs. Never throws: a failed LISTEN retries in the background. */
  start(): Promise<void>
  stop(): Promise<void>
  /** Called for every event, persisted or ephemeral, in order. A throwing listener is logged and skipped. */
  subscribe(listener: EventListener): () => void
  /**
   * Fans out an event that is not stored (text deltas). Its id is `lastSeen`, so a client's
   * `since` cursor never moves past a row it has not been sent. Not unique, and never replayed.
   */
  publishEphemeral(event: EphemeralEvent): void
  /** Persisted events matching `topics` with `since < id <= upTo`, ascending, at most `limit`. */
  replay(query: ReplayQuery): Promise<LenientEnvelope[]>
  /** Id of the newest persisted event the bus has delivered. */
  readonly lastSeen: number
  readonly status: 'idle' | 'listening' | 'reconnecting' | 'stopped'
  readonly listenerCount: number
}

type Row = typeof events.$inferSelect

/** A row as the wire envelope. Rows without a profile cannot be routed and are skipped (null). */
function toEnvelope(row: Row): LenientEnvelope | null {
  if (row.profileId === null) return null
  return {
    v: ENVELOPE_VERSION,
    id: String(row.id),
    type: row.type,
    profileId: row.profileId,
    ...(row.runId ? { runId: row.runId } : {}),
    ts: row.createdAt.toISOString(),
    payload: row.payload,
  }
}

const errName = (err: unknown) => (err instanceof Error ? err.name : typeof err)

/**
 * Fans persisted events out to in-process subscribers. One LISTEN connection says "something was
 * committed"; the table is the source of truth, so every wake-up reads `id > lastSeen` in pages.
 * That also repairs lost or coalesced notifications and a dropped connection. Ids are handed out
 * when a transaction inserts, not when it commits, so a hole in the sequence may be a transaction
 * that has not committed yet: events behind a hole wait `gapGraceMs` for it, which keeps delivery
 * in id order without losing a late commit.
 */
export function createEventBus(options: EventBusOptions): EventBus {
  const { db, source, logger } = options
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
  const gapGraceMs = options.gapGraceMs ?? DEFAULT_GAP_GRACE_MS
  const timers = options.timers ?? realTimers
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random

  const listeners = new Set<EventListener>()
  let lastSeen = 0
  let status: EventBus['status'] = 'idle'
  let connection: NotificationConnection | undefined
  let generation = 0
  let attempt = 0
  let reconnectTimer: unknown
  let gapTimer: unknown
  let retryTimer: unknown
  let gapSince: number | undefined
  let draining = false
  let rerun = false

  function dispatch(event: LenientEnvelope): void {
    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (err) {
        logger.warn({ errName: errName(err) }, 'event listener threw')
      }
    }
  }

  function scheduleGapCheck(): void {
    if (gapTimer !== undefined) return
    gapTimer = timers.setTimeout(() => {
      gapTimer = undefined
      void drain()
    }, GAP_RECHECK_MS)
  }

  function scheduleRetryDrain(): void {
    if (retryTimer !== undefined || status === 'stopped') return
    retryTimer = timers.setTimeout(() => {
      retryTimer = undefined
      void drain()
    }, RETRY_DRAIN_MS)
  }

  async function drain(): Promise<void> {
    if (status === 'stopped') return
    if (draining) {
      rerun = true
      return
    }
    draining = true
    try {
      do {
        rerun = false
        for (;;) {
          const rows = await db
            .select()
            .from(events)
            .where(gt(events.id, lastSeen))
            .orderBy(asc(events.id))
            .limit(pageSize)
          if (rows.length === 0) {
            gapSince = undefined
            break
          }
          let blocked = false
          for (const row of rows) {
            if (status === 'stopped') return
            if (row.id > lastSeen + 1) {
              gapSince ??= now()
              if (now() - gapSince < gapGraceMs) {
                blocked = true
                scheduleGapCheck()
                break
              }
              logger.debug({ from: lastSeen + 1, to: row.id - 1 }, 'event id gap did not fill')
            }
            gapSince = undefined
            const envelope = toEnvelope(row)
            if (envelope) {
              try {
                options.beforePersisted?.(envelope)
              } catch (err) {
                logger.warn({ errName: errName(err) }, 'beforePersisted hook threw')
              }
              dispatch(envelope)
            }
            lastSeen = row.id
          }
          if (blocked || rows.length < pageSize) break
        }
      } while (rerun && status !== 'stopped')
    } catch (err) {
      logger.warn({ errName: errName(err) }, 'event bus could not read new events, retrying')
      scheduleRetryDrain()
    } finally {
      draining = false
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer !== undefined || status === 'stopped') return
    status = 'reconnecting'
    const delay = backoffDelay(attempt, random, RECONNECT_BASE_MS, RECONNECT_MAX_MS)
    attempt++
    reconnectTimer = timers.setTimeout(() => {
      reconnectTimer = undefined
      void connect()
    }, delay)
  }

  async function connect(): Promise<void> {
    if (status === 'stopped') return
    const mine = ++generation
    try {
      const conn = await source.connect({
        onNotify: () => {
          if (mine === generation) void drain()
        },
        onClose: (err) => {
          if (mine !== generation || status === 'stopped') return
          logger.warn(
            { errName: err ? errName(err) : undefined },
            'event bus listen connection lost, reconnecting',
          )
          connection = undefined
          scheduleReconnect()
        },
      })
      if (status === 'stopped') {
        await conn.close().catch(() => {})
        return
      }
      connection = conn
      status = 'listening'
      attempt = 0
    } catch (err) {
      logger.warn({ errName: errName(err) }, 'event bus could not listen, retrying')
      scheduleReconnect()
      return
    }
    // Anything committed while the connection was down, or before LISTEN took hold.
    await drain()
  }

  return {
    async start() {
      if (status !== 'idle') return
      const [row] = await db
        .select({ max: sql<number>`coalesce(max(${events.id}), 0)::float8` })
        .from(events)
      lastSeen = Number(row?.max ?? 0)
      await connect()
    },

    async stop() {
      status = 'stopped'
      generation++
      for (const t of [reconnectTimer, gapTimer, retryTimer]) {
        if (t !== undefined) timers.clearTimeout(t)
      }
      reconnectTimer = gapTimer = retryTimer = undefined
      const conn = connection
      connection = undefined
      await conn?.close().catch(() => {})
    },

    subscribe(listener) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },

    publishEphemeral(event) {
      dispatch({
        v: ENVELOPE_VERSION,
        id: String(lastSeen),
        type: event.type,
        profileId: event.profileId,
        ...(event.runId ? { runId: event.runId } : {}),
        ts: new Date(now()).toISOString(),
        payload: event.payload,
      })
    },

    async replay({ since, upTo, topics, limit }) {
      const rows = await db
        .select()
        .from(events)
        .where(
          and(
            gt(events.id, since),
            lte(events.id, upTo),
            isNotNull(events.profileId),
            topicWhere(topics),
          ),
        )
        .orderBy(asc(events.id))
        .limit(limit)
      return rows.flatMap((row) => {
        const envelope = toEnvelope(row)
        return envelope ? [envelope] : []
      })
    },

    get lastSeen() {
      return lastSeen
    },
    get status() {
      return status
    },
    get listenerCount() {
      return listeners.size
    },
  }
}
