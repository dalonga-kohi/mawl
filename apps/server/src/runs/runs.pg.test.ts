import { createDb, migrate } from '@mawl/db'
import { withPostgres } from '@mawl/testkit'
import { describe } from 'vitest'
import { describeProfileService } from '../profiles/service-suite.ts'
import { describeBundleOnPostgres } from './bundle-suite.ts'
import { describeRunEngineE2e } from './e2e-suite.ts'
import { describeRunService } from './service-suite.ts'
import { describeRunStore } from './store-suite.ts'

// One container for everything in this slice that needs real Postgres: Docker Desktop starts
// each container slowly, and several in parallel starved the rest of the gate.
describe('runs on real Postgres', () => {
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

  const nodePg = async () => {
    const handle = createDb(await freshDatabaseUrl())
    return {
      db: handle.db,
      migrate: () => migrate(handle.db),
      close: () => handle.close(),
    }
  }

  describeProfileService('profile service (node-postgres)', nodePg)
  describeRunStore('run store (node-postgres)', nodePg)
  describeRunService('run service (node-postgres)', nodePg)
  describeRunEngineE2e(url)
  describeBundleOnPostgres(url)
})
