import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { migrationsFolder, schema } from '@faire/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { describeRunEdges } from './edge-suite.ts'

describeRunEdges('run engine edge cases on PGlite (in process)', async () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  return {
    db,
    migrate: () => migrate(db, { migrationsFolder }),
    close: () => client.close(),
  }
})
