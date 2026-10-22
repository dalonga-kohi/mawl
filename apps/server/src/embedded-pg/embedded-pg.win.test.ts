import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pg from 'pg'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { CLUSTER_DIR } from './cluster.ts'
import {
  defaultDeps,
  type EmbeddedPostgres,
  type StartOptions,
  startEmbeddedPostgres,
} from './embedded-pg.ts'
import { embeddedPgPolicy } from './test-policy.ts'

/**
 * The real EDB binaries (MAWL_PG_ROOT, from infra/desktop/fetch-pg.ps1). Windows-only: skips
 * elsewhere or without the bundle, fails when MAWL_REQUIRE_EMBEDDED_PG is set (Windows CI job).
 */
const policy = embeddedPgPolicy()
if (policy.action === 'skip') {
  process.stderr.write(`[embedded-pg] ${policy.reason}: skipping the real-binary suite\n`)
}

/** Postgres runs with lc_messages=C (initdb --no-locale), so its log lines are English. */
const RECOVERY = /not properly shut down|automatic recovery in progress|was interrupted/
const CLEAN_START = /database system was shut down at/

describe.skipIf(policy.action === 'skip')(
  'embedded Postgres on the real binaries',
  () => {
    const pgRoot = policy.pgRoot
    let scratch = ''
    let template = ''
    let coldStartMs = 0
    const running = new Set<EmbeddedPostgres>()
    const servers: Server[] = []

    const start = async (dataRoot: string, extra: Partial<StartOptions> = {}) => {
      const handle = await startEmbeddedPostgres({ pgRoot, dataRoot, ...extra })
      running.add(handle)
      return handle
    }
    const stop = async (handle: EmbeddedPostgres) => {
      const r = await handle.stop()
      running.delete(handle)
      return r
    }
    /** A data root holding a copy of the cleanly stopped template cluster (skips a 4 s initdb). */
    const warmRoot = async (name: string) => {
      const dir = join(scratch, name)
      await cp(template, dir, { recursive: true })
      return dir
    }
    /** Holds a loopback port like another app would; drops any connection so close() never waits. */
    const occupyPort = () => {
      const blocker = createServer((socket) => socket.destroy())
      servers.push(blocker)
      return new Promise<number>((resolve) =>
        blocker.listen(0, '127.0.0.1', () => {
          const a = blocker.address()
          resolve(typeof a === 'object' && a ? a.port : 0)
        }),
      )
    }
    const query = async (h: EmbeddedPostgres, sql: string) => {
      const client = new pg.Client({ connectionString: h.connectionString })
      await client.connect()
      try {
        return (await client.query(sql)).rows
      } finally {
        await client.end()
      }
    }

    beforeAll(async () => {
      if (policy.action === 'fail') throw new Error(policy.reason)
      scratch = await mkdtemp(join(tmpdir(), 'mawl-epg-win-'))
      template = join(scratch, 'template')
      const t0 = performance.now()
      const h = await start(template)
      coldStartMs = performance.now() - t0
      expect(h.cold).toBe(true)
      await query(h, "create table kept (v text); insert into kept values ('from the cold start')")
      expect(await stop(h)).toEqual({ clean: true })
    }, 180_000)

    afterEach(async () => {
      for (const h of running) await h.stop()
      running.clear()
      for (const s of servers.splice(0)) await new Promise((r) => s.close(r))
    })

    afterAll(async () => {
      for (const h of running) await h.stop()
      if (scratch) await rm(scratch, { recursive: true, force: true, maxRetries: 5 })
    })

    it('cold start initialises a cluster that only answers on loopback with the generated password', async () => {
      process.stderr.write(
        `[embedded-pg] cold start (initdb + start) ${Math.round(coldStartMs)} ms\n`,
      )
      const h = await start(await warmRoot('cold-check'))
      const [row] = await query(
        h,
        "select current_database() as db, current_user as usr, current_setting('listen_addresses') as listen",
      )
      expect(row).toEqual({ db: 'mawl', usr: 'mawl', listen: '127.0.0.1' })

      const bad = new pg.Client({ ...h.connection, password: 'wrong' })
      bad.on('error', () => {})
      await expect(bad.connect()).rejects.toMatchObject({ code: '28P01' })
    })

    it('warm start keeps the data, and a clean stop means no crash recovery on the next start', async () => {
      const root = await warmRoot('warm')
      const first = await start(root)
      expect(first.cold).toBe(false)
      expect(await query(first, 'select v from kept')).toEqual([{ v: 'from the cold start' }])
      await query(first, "insert into kept values ('from the warm start')")
      expect(await stop(first)).toEqual({ clean: true })
      expect(await first.exited).toMatchObject({ code: 0, expected: true })

      const t0 = performance.now()
      const second = await start(root)
      process.stderr.write(`[embedded-pg] warm start ${Math.round(performance.now() - t0)} ms\n`)
      expect(second.output()).toMatch(CLEAN_START)
      expect(second.output()).not.toMatch(RECOVERY)
      expect(await query(second, 'select count(*)::int as n from kept')).toEqual([{ n: 2 }])
    })

    it('a hard-killed postgres recovers its committed data on the next start', async () => {
      const root = await warmRoot('killed')
      const first = await start(root)
      await query(first, "insert into kept values ('committed before the kill')")
      expect(first.pid).toBeTypeOf('number')
      process.kill(first.pid ?? 0, 'SIGKILL')
      expect(await first.exited).toMatchObject({ expected: false })
      running.delete(first)
      expect(await first.stop()).toEqual({ clean: false })

      const second = await start(root)
      expect(second.output()).toMatch(RECOVERY)
      expect(await query(second, 'select count(*)::int as n from kept')).toEqual([{ n: 2 }])
      expect(await stop(second)).toEqual({ clean: true })
    })

    it('moves to another port when the picked one is taken', async () => {
      const busy = await occupyPort()
      const real = defaultDeps()
      let picks = 0
      const h = await start(await warmRoot('collide'), {
        deps: { findFreePort: async () => (picks++ === 0 ? busy : real.findFreePort()) },
      })
      expect(picks).toBe(2)
      expect(h.port).not.toBe(busy)
      expect(await query(h, 'select 1 as one')).toEqual([{ one: 1 }])
    })

    it('fails with port_unavailable when every pick is taken', async () => {
      const busy = await occupyPort()
      await expect(
        start(await warmRoot('collide-all'), {
          maxPortAttempts: 2,
          deps: { findFreePort: async () => busy },
        }),
      ).rejects.toMatchObject({ code: 'port_unavailable' })
    })

    it('a cluster with a missing file gives data_dir_corrupt without starting postgres', async () => {
      const root = await warmRoot('missing')
      await rm(join(root, CLUSTER_DIR, 'global', 'pg_control'))
      await expect(start(root)).rejects.toMatchObject({ code: 'data_dir_corrupt' })
    })

    it('a cluster with a garbled control file gives start_failed with the postgres output', async () => {
      const root = await warmRoot('garbled')
      await writeFile(join(root, CLUSTER_DIR, 'global', 'pg_control'), Buffer.alloc(8192, 0x5a))
      const err = await start(root).catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'start_failed' })
      expect((err as { detail?: string }).detail).not.toBe('')
    })

    it('a rejected password gives data_dir_corrupt and stops postgres again', async () => {
      const root = await warmRoot('wrong-password')
      await writeFile(join(root, 'password'), `${'B'.repeat(43)}\n`)
      await expect(start(root)).rejects.toMatchObject({ code: 'data_dir_corrupt' })
    })
  },
  120_000,
)
