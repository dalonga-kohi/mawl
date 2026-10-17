import { withPostgres } from '@faire/testkit'
import { describe, expect, it } from 'vitest'
import { createDb, migrate } from './index.ts'
import { describeMigrations } from './migration-suite.ts'

// Real Postgres + pgvector via Testcontainers. Skips locally without Docker, fails in CI.
describe('migrations on real Postgres', () => {
  const url = withPostgres()

  /** One container per suite: give every test its own database inside it. */
  async function freshDatabaseUrl() {
    const { Client } = await import('pg')
    const admin = new Client({ connectionString: url() })
    await admin.connect()
    const name = `t_${Math.random().toString(36).slice(2, 10)}`
    await admin.query(`create database ${name}`)
    await admin.end()
    const u = new URL(url())
    u.pathname = `/${name}`
    return u.toString()
  }

  describeMigrations('node-postgres', async () => {
    const handle = createDb(await freshDatabaseUrl())
    return {
      db: handle.db,
      migrate: () => migrate(handle.db),
      close: () => handle.close(),
    }
  })

  it('two concurrent migrate() calls on one database both succeed', async () => {
    const target = await freshDatabaseUrl()
    const a = createDb(target)
    const b = createDb(target)
    try {
      await Promise.all([migrate(a.db), migrate(b.db)])
      const r = await a.pool.query('select count(*)::int as n from drizzle.__drizzle_migrations')
      expect(r.rows[0].n).toBe(2)
    } finally {
      await Promise.all([a.close(), b.close()])
    }
  })
})
