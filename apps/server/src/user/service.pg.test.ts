import { createDb, migrate } from '@mawl/db'
import { withPostgres } from '@mawl/testkit'
import { describe } from 'vitest'
import { describeUserService } from './service-suite.ts'

// Real Postgres via Testcontainers. Skips locally without Docker, fails in CI.
describe('user service on real Postgres', () => {
  const url = withPostgres()

  describeUserService('node-postgres', async () => {
    const handle = createDb(url())
    return {
      db: handle.db,
      migrate: () => migrate(handle.db),
      close: () => handle.close(),
    }
  })
})
