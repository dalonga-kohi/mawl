import { withPostgres } from '@faire/testkit'
import { describe } from 'vitest'
import { createDb, migrate } from './index.ts'
import { describeMigrations } from './migration-suite.ts'

// Real Postgres + pgvector via Testcontainers. Skips locally without Docker, fails in CI.
describe('migrations on real Postgres', () => {
  const url = withPostgres()
  describeMigrations('node-postgres', async () => {
    // One container per suite: give every test its own database inside it.
    const { Client } = await import('pg')
    const admin = new Client({ connectionString: url() })
    await admin.connect()
    const name = `t_${Math.random().toString(36).slice(2, 10)}`
    await admin.query(`create database ${name}`)
    await admin.end()
    const u = new URL(url())
    u.pathname = `/${name}`
    const handle = createDb(u.toString())
    return {
      db: handle.db,
      migrate: () => migrate(handle.db),
      close: () => handle.close(),
    }
  })
})
