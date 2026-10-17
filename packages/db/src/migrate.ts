import { fileURLToPath } from 'node:url'
import type { NodePgClient, NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

// Kept free of schema/contracts imports so `node src/bin/migrate.ts` runs without a bundler.

/** Generated SQL migrations (and drizzle's journal). Committed; never hand-edit applied files. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** Arbitrary fixed key for the migration advisory lock (bigint range). */
const MIGRATION_LOCK_KEY = 7_243_001

/** The one capability the lock needs; lets tests pass a fake. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>
}

/**
 * Runs `fn` while holding the migration advisory lock on one dedicated session. Errors from
 * `fn` win: a failing unlock never masks them. If the lock or unlock failed, the connection is
 * suspect, so it is destroyed (release(err)) instead of returned to the pool; that also frees
 * the session lock.
 *
 * With a Pool this holds one connection while `fn` uses another, so the pool needs max >= 2.
 */
export async function withAdvisoryLock<T>(
  client: NodePgClient | Queryable,
  fn: () => Promise<T>,
): Promise<T> {
  const pooled = client instanceof pg.Pool
  const locker: Queryable = pooled ? await client.connect() : client
  let suspect: Error | undefined
  try {
    try {
      await locker.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY])
    } catch (e) {
      suspect = e instanceof Error ? e : new Error(String(e))
      throw e
    }
    let failed = false
    let failure: unknown
    let result: T | undefined
    try {
      result = await fn()
    } catch (e) {
      failed = true
      failure = e
    }
    try {
      await locker.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
    } catch (e) {
      suspect = e instanceof Error ? e : new Error(String(e))
      if (!failed) throw e
    }
    if (failed) throw failure
    return result as T
  } finally {
    if (pooled) (locker as pg.PoolClient).release(suspect)
  }
}

/**
 * Applies pending migrations. Idempotent: already-applied migrations are skipped. Serialised
 * across processes with a Postgres advisory lock, so servers starting together do not race on
 * the journal. Pool must allow max >= 2 connections. 'folder' overrides the bundled location,
 * for deployments that ship the SQL next to a single-file bundle.
 */
export async function migrate<S extends Record<string, unknown>>(
  db: NodePgDatabase<S> & { $client: NodePgClient },
  folder: string = migrationsFolder,
): Promise<void> {
  await withAdvisoryLock(db.$client, () => drizzleMigrate(db, { migrationsFolder: folder }))
}
