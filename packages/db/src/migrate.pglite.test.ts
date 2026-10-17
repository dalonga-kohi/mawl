import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { migrationsFolder } from './index.ts'
import { describeMigrations } from './migration-suite.ts'
import * as schema from './schema.ts'

describeMigrations('migrations on PGlite (in process)', async () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  return {
    db,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  }
})
