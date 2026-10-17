import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate, migrationsFolder } from './migrate.ts'
import * as schema from './schema.ts'

export const packageName = '@faire/db'

export { migrate, migrationsFolder, schema }

export type Db = NodePgDatabase<typeof schema>

export interface DbHandle {
  db: Db
  pool: pg.Pool
  /** Ends the pool. Safe to call once, at shutdown. */
  close(): Promise<void>
}

/** Opens a node-postgres pool for `url` and wraps it in a typed drizzle instance. */
export function createDb(url: string): DbHandle {
  const pool = new pg.Pool({ connectionString: url })
  const db = drizzle(pool, { schema })
  return { db, pool, close: () => pool.end() }
}
