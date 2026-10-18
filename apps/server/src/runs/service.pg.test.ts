import { createDb, migrate } from '@faire/db'
import { withPostgres } from '@faire/testkit'
import { describe } from 'vitest'
import { describeRunService } from './service-suite.ts'

// Real Postgres via Testcontainers. Skips locally without Docker, fails in CI.
describe('run service on real Postgres', () => {
  const url = withPostgres()

  async function freshDatabaseUrl() {
    const admin = createDb(url())
    const name = `t_${Math.random().toString(36).slice(2, 10)}`
    await admin.pool.query(`create database ${name}`)
    await admin.close()
    const u = new URL(url())
    u.pathname = `/${name}`
    return u.toString()
  }

  describeRunService('node-postgres', async () => {
    const handle = createDb(await freshDatabaseUrl())
    return {
      db: handle.db,
      migrate: () => migrate(handle.db),
      close: () => handle.close(),
    }
  })
})
