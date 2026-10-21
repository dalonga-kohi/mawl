import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate, migrationsFolder } from './migrate.ts'
import * as schema from './schema.ts'

export const packageName = '@mawl/db'

export { migrate, migrationsFolder, schema }

export type Db = NodePgDatabase<typeof schema> & { $client: pg.Pool }

export interface DbHandle {
  db: Db
  pool: pg.Pool
  /** Ends the pool. Safe to call once, at shutdown. */
  close(): Promise<void>
}

export interface CreateDbOptions {
  /** Called when an idle pooled client errors (e.g. the server restarted). Keep it free of secrets. */
  onError?: (err: Error) => void
}

/** Max wait for a free or new connection, so a dead database fails callers instead of hanging them. */
export const CONNECTION_TIMEOUT_MS = 5000

/**
 * Opens a node-postgres pool for `url` and wraps it in a typed drizzle instance. A pool
 * 'error' listener is always attached: without one, an idle client error is an uncaught
 * exception that kills the process.
 */
export function createDb(url: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
  })
  pool.on('error', (err) => options.onError?.(err))
  // An error on a checked-out client (the pool only listens while a client is idle) would be
  // uncaught too. Graphile Worker also warns when a pool has no 'connect' handler like this one.
  pool.on('connect', (client) => client.on('error', (err) => options.onError?.(err)))
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}
