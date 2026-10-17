import { fileURLToPath } from 'node:url'
import type { NodePgClient, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

// Kept free of schema/contracts imports so `node src/bin/migrate.ts` runs without a bundler.

/** Generated SQL migrations (and drizzle's journal). Committed; never hand-edit applied files. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** Arbitrary fixed key for the migration advisory lock (bigint range). */
const MIGRATION_LOCK_KEY = 7_243_001

/**
 * Applies pending migrations. Idempotent: already-applied migrations are skipped. Serialised
 * across processes with a session-level Postgres advisory lock, so servers starting together
 * do not race on the journal.
 */
export async function migrate<S extends Record<string, unknown>>(
  db: NodePgDatabase<S> & { $client: NodePgClient },
): Promise<void> {
  const client = db.$client
  // A pool needs a dedicated connection: advisory locks belong to one session.
  const locker = client instanceof pg.Pool ? await client.connect() : client
  try {
    await locker.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    try {
      await drizzleMigrate(db, { migrationsFolder })
    } finally {
      await locker.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    }
  } finally {
    if (client instanceof pg.Pool) (locker as pg.PoolClient).release()
  }
}
