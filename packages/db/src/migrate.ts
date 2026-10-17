import { fileURLToPath } from 'node:url'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator'

// Kept free of schema/contracts imports so `node scripts/migrate.ts` runs without a bundler.

/** Generated SQL migrations (and drizzle's journal). Committed; never hand-edit applied files. */
export const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url))

/** Applies pending migrations. Idempotent: already-applied migrations are skipped. */
export async function migrate<S extends Record<string, unknown>>(
  db: NodePgDatabase<S>,
): Promise<void> {
  await drizzleMigrate(db, { migrationsFolder })
}
