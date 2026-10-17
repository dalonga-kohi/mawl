// Applies committed migrations to $DATABASE_URL: `pnpm --filter @faire/db db:migrate`.
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { migrate } from '../migrate.ts'

const url = process.env.DATABASE_URL
if (!url) {
  process.stderr.write('DATABASE_URL is not set\n')
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: url })
try {
  await migrate(drizzle(pool))
  process.stdout.write('migrations applied\n')
} finally {
  await pool.end()
}
