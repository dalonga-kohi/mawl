import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { binaryPath, CLUSTER_DIR, PASSWORD_FILE } from './cluster.ts'
import { type EmbeddedPgDeps, type ProbeResult, startEmbeddedPostgres } from './embedded-pg.ts'
import { type FakeBehaviour, type FakeChild, fakeClock, fakeInitdbOk, fakeSpawn } from './fakes.ts'

let root = ''
let pgRoot = ''
let dataRoot = ''
const PASSWORD = 'A'.repeat(43)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mawl-epg-life-'))
  pgRoot = join(root, 'pg')
  dataRoot = join(root, 'data')
  await mkdir(join(pgRoot, 'bin'), { recursive: true })
  for (const n of ['initdb', 'postgres', 'pg_ctl']) await writeFile(binaryPath(pgRoot, n), '')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function warmCluster() {
  const dir = join(dataRoot, CLUSTER_DIR)
  await mkdir(join(dir, 'global'), { recursive: true })
  await writeFile(join(dir, 'PG_VERSION'), '17\n')
  await writeFile(join(dir, 'global', 'pg_control'), 'x')
  await writeFile(join(dir, 'postgresql.conf'), '')
  await writeFile(join(dataRoot, PASSWORD_FILE), `${PASSWORD}\n`)
}

/** Postgres that runs until pg_ctl stops it (exit 0) or it is killed. */
const runningPostgres: FakeBehaviour = (child) => {
  child.stderr.write('LOG:  database system is ready to accept connections\n')
}

/** pg_ctl stop that shuts the running fake postgres down and exits 0. */
const pgCtlStops =
  (postgres: () => FakeChild | undefined, code = 0): FakeBehaviour =>
  (child) => {
    if (code === 0) postgres()?.exit(0)
    child.exit(code)
  }

interface Harness {
  deps: EmbeddedPgDeps
  spawn: ReturnType<typeof fakeSpawn>
  clock: ReturnType<typeof fakeClock>
  ensured: string[]
  ports: number[]
}

function harness({
  postgres = runningPostgres,
  pgCtl,
  probe,
  ports = [5501, 5502, 5503, 5504],
  busy = new Set<number>(),
}: {
  postgres?: FakeBehaviour
  pgCtl?: FakeBehaviour
  probe?: EmbeddedPgDeps['probe']
  ports?: number[]
  busy?: Set<number>
} = {}): Harness {
  const queue = [...ports]
  const ensured: string[] = []
  const lastPostgres = () => spawn.of('postgres').at(-1)
  const spawn = fakeSpawn({
    initdb: fakeInitdbOk(),
    postgres,
    pg_ctl: pgCtl ?? pgCtlStops(lastPostgres),
  })
  const clock = fakeClock()
  /** Like a real connect: takes a moment, and only a live postgres answers. */
  const liveProbe = async (): Promise<ProbeResult> => {
    await new Promise((resolve) => setImmediate(resolve))
    const c = lastPostgres()
    return c && c.exitCode === null && c.signalCode === null ? 'ready' : 'not_ready'
  }
  return {
    spawn,
    clock,
    ensured,
    ports,
    deps: {
      spawn: spawn.spawn,
      clock,
      findFreePort: async () => {
        const p = queue.shift()
        if (p === undefined) throw new Error('out of ports')
        return p
      },
      isPortFree: async (port) => !busy.has(port),
      probe: probe ?? liveProbe,
      ensureDatabase: async (conn) => {
        ensured.push(conn.database)
      },
    },
  }
}

describe('startEmbeddedPostgres', () => {
  it('cold start: initdb, then postgres on a loopback port, then the app database', async () => {
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })

    expect(pg.cold).toBe(true)
    // initdb, then initdb --sync-only on the staging dir.
    expect(h.spawn.of('initdb').map((c) => c.args.includes('--sync-only'))).toEqual([false, true])
    const [postgres] = h.spawn.of('postgres')
    expect(postgres?.args).toEqual([
      '-D',
      join(dataRoot, CLUSTER_DIR),
      '-p',
      '5501',
      '-c',
      'listen_addresses=127.0.0.1',
      '-c',
      'logging_collector=off',
    ])
    expect(postgres?.opts).toEqual({ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    expect(pg.port).toBe(5501)
    expect(pg.connection).toMatchObject({
      host: '127.0.0.1',
      port: 5501,
      user: 'mawl',
      database: 'mawl',
    })
    expect(pg.connectionString).toBe(
      `postgres://mawl:${pg.connection.password}@127.0.0.1:5501/mawl`,
    )
    expect(h.ensured).toEqual(['mawl'])
    await pg.stop()
  })

  it('warm start: no initdb, the stored password', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(pg.cold).toBe(false)
    expect(h.spawn.of('initdb')).toHaveLength(0)
    expect(pg.connection.password).toBe(PASSWORD)
    await pg.stop()
  })

  it('never puts the password on a command line', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    await pg.stop()
    for (const c of h.spawn.children) expect(c.args.join(' ')).not.toContain(PASSWORD)
  })

  it('polls until postgres accepts connections', async () => {
    await warmCluster()
    let calls = 0
    const h = harness({ probe: async () => (++calls < 4 ? 'not_ready' : 'ready') })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(calls).toBe(4)
    await pg.stop()
  })

  it('fails with binaries_missing before touching the data root', async () => {
    await rm(binaryPath(pgRoot, 'postgres'))
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'binaries_missing',
    })
    expect(h.spawn.children).toHaveLength(0)
  })

  it('fails with data_dir_corrupt and spawns nothing when the cluster is incomplete', async () => {
    await warmCluster()
    await rm(join(dataRoot, CLUSTER_DIR, 'PG_VERSION'))
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
    expect(h.spawn.children).toHaveLength(0)
  })

  it('retries on a new port when another process took the picked one first', async () => {
    await warmCluster()
    const h = harness({
      busy: new Set([5501]),
      postgres: (child) => {
        if (child.args.includes('5501')) {
          child.stderr.write('could not bind IPv4 address\n')
          child.exit(1)
        }
      },
    })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(pg.port).toBe(5502)
    expect(h.spawn.of('postgres')).toHaveLength(2)
    await pg.stop()
  })

  it('fails with port_unavailable when every attempt collides', async () => {
    await warmCluster()
    const h = harness({
      busy: new Set([5501, 5502, 5503]),
      postgres: (child) => child.exit(1),
    })
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, maxPortAttempts: 3 }),
    ).rejects.toMatchObject({ code: 'port_unavailable' })
    expect(h.spawn.of('postgres')).toHaveLength(3)
  })

  it('fails with start_failed and the output tail when postgres exits for another reason', async () => {
    await warmCluster()
    const h = harness({
      postgres: (child) => {
        child.stderr.write('FATAL:  could not open file "global/pg_filenode.map"\n')
        child.exit(1)
      },
    })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'start_failed' })
    expect((err as { detail?: string }).detail).toContain('pg_filenode.map')
    expect(h.spawn.of('postgres')).toHaveLength(1)
  })

  it('fails with start_failed when postgres cannot be spawned', async () => {
    await warmCluster()
    const h = harness({
      postgres: (child) => {
        setImmediate(() => child.emit('error', new Error('spawn postgres.exe EACCES')))
      },
    })
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'start_failed',
    })
  })

  it('stops postgres and fails with start_timeout when it never becomes ready', async () => {
    await warmCluster()
    const h = harness({ probe: async () => 'not_ready' })
    const err = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      startTimeoutMs: 5_000,
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'start_timeout' })
    const [postgres] = h.spawn.of('postgres')
    expect(postgres?.exitCode !== null || postgres?.signalCode !== null).toBe(true)
  })

  it('stops postgres and fails with data_dir_corrupt when the stored password is rejected', async () => {
    await warmCluster()
    const h = harness({ probe: async () => 'auth_failed' })
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, authGraceMs: 100 }),
    ).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
    const [postgres] = h.spawn.of('postgres')
    expect(postgres?.exitCode).toBe(0)
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('treats a password rejection from a foreign server on a lost port as a port race', async () => {
    await warmCluster()
    // Our postgres lost the port and exits a moment after the probe reached whoever holds it.
    const h = harness({
      busy: new Set([5501]),
      postgres: (child) => {
        if (child.args.includes('5501')) setTimeout(() => child.exit(1), 20)
      },
      probe: async (conn) => (conn.port === 5501 ? 'auth_failed' : 'ready'),
    })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(pg.port).toBe(5502)
    await pg.stop()
  })

  it('stops postgres and fails with start_failed when the readiness probe throws', async () => {
    await warmCluster()
    const h = harness({
      probe: async () => {
        throw new Error('probe exploded')
      },
    })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'start_failed' })
    expect((err as Error).message).toContain('probe exploded')
    const [postgres] = h.spawn.of('postgres')
    expect(postgres?.exitCode !== null || postgres?.signalCode !== null).toBe(true)
  })

  it('fails with start_failed when spawning postgres throws synchronously', async () => {
    await warmCluster()
    const h = harness({
      postgres: () => {
        throw new Error('spawn EINVAL')
      },
    })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'start_failed' })
    expect((err as Error).message).toContain('spawn EINVAL')
  })

  it('keeps the latest output for diagnostics', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    await vi.waitFor(() => expect(pg.output()).toContain('ready to accept connections'))
    await pg.stop()
  })
})

describe('stop', () => {
  it('stops with pg_ctl stop -m fast -w and reports a clean shutdown', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(await pg.stop()).toEqual({ clean: true })

    const [pgCtl] = h.spawn.of('pg_ctl')
    expect(pgCtl?.args).toEqual(
      expect.arrayContaining(['stop', '-D', join(dataRoot, CLUSTER_DIR), '-m', 'fast', '-w']),
    )
    expect(h.spawn.of('postgres')[0]?.kills).toEqual([])
    expect(await pg.exited).toMatchObject({ code: 0, expected: true })
  })

  it('is idempotent: concurrent and repeated calls share one shutdown', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const [a, b] = await Promise.all([pg.stop(), pg.stop()])
    await pg.stop()
    expect(a).toEqual({ clean: true })
    expect(b).toEqual({ clean: true })
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('falls back to killing postgres when pg_ctl fails', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(1) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(await pg.stop()).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills.length).toBe(1)
    expect(await pg.exited).toMatchObject({ expected: true })
  })

  it('kills a hung pg_ctl and then postgres after the stop timeout', async () => {
    await warmCluster()
    const h = harness({ pgCtl: () => {} })
    const pg = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      stopTimeoutMs: 10_000,
    })
    const stopping = pg.stop()
    await vi.waitFor(() => expect(h.spawn.of('pg_ctl')).toHaveLength(1))
    h.clock.advance(60_000)
    expect(await stopping).toEqual({ clean: false })
    expect(h.spawn.of('pg_ctl')[0]?.kills.length).toBe(1)
    expect(h.spawn.of('postgres')[0]?.kills.length).toBe(1)
  })

  it('kills postgres when pg_ctl succeeds but postgres does not exit', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(0) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const stopping = pg.stop()
    await vi.waitFor(() => expect(h.spawn.of('pg_ctl')[0]?.exitCode).toBe(0))
    h.clock.advance(60_000)
    expect(await stopping).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills.length).toBe(1)
  })

  it('reports an unexpected exit and does not run pg_ctl for a dead postgres', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    h.spawn.of('postgres')[0]?.exit(null, 'SIGKILL')
    expect(await pg.exited).toMatchObject({ signal: 'SIGKILL', expected: false })
    expect(await pg.stop()).toEqual({ clean: false })
    expect(h.spawn.of('pg_ctl')).toHaveLength(0)
  })
})
