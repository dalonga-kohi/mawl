import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { migrationsFolder, schema } from '@faire/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import type { ProvidersDb } from '../providers/types.ts'
import { EVENTS_CHANNEL, type NotificationSource } from './source.ts'

/** An in-process Postgres with every migration applied. */
export async function pgliteDb() {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder })
  return { client, db: db as unknown as ProvidersDb, close: () => client.close() }
}

/** LISTEN on a PGlite instance (same process only). Tests can also drop the "connection". */
export function pgliteSource(client: PGlite) {
  const live = new Set<{ close(): Promise<void>; onClose(err?: Error): void }>()
  let connects = 0
  let failNext = 0
  const source: NotificationSource = {
    async connect({ onNotify, onClose }) {
      connects++
      if (failNext > 0) {
        failNext--
        throw new Error('listen connection refused')
      }
      const unlisten = await client.listen(EVENTS_CHANNEL, () => onNotify())
      const conn = { close: () => unlisten(), onClose }
      live.add(conn)
      return {
        close: async () => {
          live.delete(conn)
          await unlisten()
        },
      }
    },
  }
  return {
    source,
    /** Number of connect() calls so far. */
    get connects() {
      return connects
    },
    /** Makes the next n connect() calls fail. */
    failConnects(n: number) {
      failNext = n
    },
    /** Simulates the server killing the LISTEN connection. */
    async drop(err = new Error('terminating connection')) {
      for (const conn of [...live]) {
        live.delete(conn)
        await conn.close()
        conn.onClose(err)
      }
    },
  }
}

export interface FakeTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  /** Pending timers by due time, soonest first. */
  readonly pending: { at: number; ms: number }[]
  now(): number
  /** Moves time forward, running every timer that falls due (including ones they add). */
  advance(ms: number): void
}

/** Manual timers: nothing runs until `advance`. Avoids vitest's global fake timers around PGlite. */
export function fakeTimers(start = 0): FakeTimers {
  let now = start
  let nextId = 1
  const timers = new Map<number, { at: number; ms: number; fn: () => void }>()
  return {
    setTimeout(fn, ms) {
      const id = nextId++
      timers.set(id, { at: now + ms, ms, fn })
      return id
    },
    clearTimeout(handle) {
      timers.delete(handle as number)
    },
    get pending() {
      return [...timers.values()].sort((a, b) => a.at - b.at).map(({ at, ms }) => ({ at, ms }))
    },
    now: () => now,
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = due[1].at
        due[1].fn()
      }
      now = target
    },
  }
}
