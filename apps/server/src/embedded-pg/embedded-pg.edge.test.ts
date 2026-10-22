import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  binaryPath,
  CLUSTER_DIR,
  initCluster,
  PASSWORD_FILE,
  PWFILE_PREFIX,
  removeStaleArtifacts,
  STAGING_PREFIX,
} from './cluster.ts'
import { type EmbeddedPgDeps, type ProbeResult, startEmbeddedPostgres } from './embedded-pg.ts'
import { type FakeBehaviour, type FakeChild, fakeClock, fakeInitdbOk, fakeSpawn } from './fakes.ts'
import type { LineLogger } from './process.ts'

let root = ''
let pgRoot = ''
let dataRoot = ''
const PASSWORD = 'B'.repeat(43)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mawl-epg-edge-'))
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

const runningPostgres: FakeBehaviour = (child) => {
  child.stderr.write('LOG:  ready\n')
}

function harness({
  postgres = runningPostgres,
  pgCtl,
  probe,
  ports = [6001, 6002, 6003, 6004],
  busy = new Set<number>(),
  ensureDatabase,
}: {
  postgres?: FakeBehaviour
  pgCtl?: FakeBehaviour
  probe?: EmbeddedPgDeps['probe']
  ports?: number[]
  busy?: Set<number>
  ensureDatabase?: EmbeddedPgDeps['ensureDatabase']
} = {}) {
  const queue = [...ports]
  const lastPostgres = (): FakeChild | undefined => spawn.of('postgres').at(-1)
  const spawn = fakeSpawn({
    initdb: fakeInitdbOk(),
    postgres,
    pg_ctl:
      pgCtl ??
      ((child) => {
        lastPostgres()?.exit(0)
        child.exit(0)
      }),
  })
  const clock = fakeClock()
  const probes: number[] = []
  const liveProbe = async (): Promise<ProbeResult> => {
    await new Promise((resolve) => setImmediate(resolve))
    const c = lastPostgres()
    return c && c.exitCode === null && c.signalCode === null ? 'ready' : 'not_ready'
  }
  const deps: EmbeddedPgDeps = {
    spawn: spawn.spawn,
    clock,
    findFreePort: async () => {
      const p = queue.shift()
      if (p === undefined) throw new Error('out of ports')
      return p
    },
    isPortFree: async (port) => !busy.has(port),
    probe: async (conn) => {
      probes.push(conn.port)
      return (probe ?? liveProbe)(conn)
    },
    ensureDatabase: ensureDatabase ?? (async () => {}),
  }
  return { spawn, clock, deps, probes }
}

function recordingLogger() {
  const lines: { level: string; msg: string }[] = []
  const logger: LineLogger = {
    debug: () => {},
    info: (_o, msg) => lines.push({ level: 'info', msg }),
    warn: (_o, msg) => lines.push({ level: 'warn', msg }),
    error: (_o, msg) => lines.push({ level: 'error', msg }),
  }
  return { logger, lines }
}

const transient = (code: string) => async () => {
  throw Object.assign(new Error(code), { code })
}

describe('stop: idempotence and races', () => {
  it('returns the very same shutdown promise on every call, even after it settled', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const a = pg.stop()
    const b = pg.stop()
    expect(b).toBe(a)
    await a
    expect(pg.stop()).toBe(a)
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('marks the exit expected even when stop is called while postgres is still running its exit', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const stopping = pg.stop()
    expect(await pg.exited).toMatchObject({ expected: true })
    await stopping
  })

  it('does not call stop an expected exit when postgres died before stop', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    h.spawn.of('postgres')[0]?.exit(1)
    const exit = await pg.exited
    await pg.stop()
    expect(exit.expected).toBe(false)
    expect(h.spawn.of('pg_ctl')).toHaveLength(0)
    expect(h.spawn.of('postgres')[0]?.kills).toEqual([])
  })

  it('never rejects when pg_ctl cannot be spawned: kills postgres instead', async () => {
    await warmCluster()
    const h = harness({
      pgCtl: (child) => {
        setImmediate(() => child.emit('error', new Error('spawn pg_ctl.exe EACCES')))
      },
    })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(await pg.stop()).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1)
  })

  it('never rejects when spawn itself throws for pg_ctl', async () => {
    await warmCluster()
    const h = harness()
    const realSpawn = h.deps.spawn
    const deps: EmbeddedPgDeps = {
      ...h.deps,
      spawn: (command, args, opts) => {
        if (/pg_ctl/.test(command)) throw new Error('spawn UNKNOWN')
        return realSpawn(command, args, opts)
      },
    }
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps })
    expect(await pg.stop()).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1)
  })

  it('passes -t as whole seconds rounded up from stopTimeoutMs', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      stopTimeoutMs: 1_500,
    })
    await pg.stop()
    const args = h.spawn.of('pg_ctl')[0]?.args ?? []
    expect(args[args.indexOf('-t') + 1]).toBe('2')
  })

  it('treats a pg_ctl killed by a signal as failed and kills postgres', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(null, 'SIGKILL') })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(await pg.stop()).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1)
  })
})

describe('stop: kill fallback timing', () => {
  it('stays clean when postgres exits just inside the 5 s grace after pg_ctl succeeds', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(0) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const stopping = pg.stop()
    await vi.waitFor(() => expect(h.clock.slept).toContain(5_000))
    h.clock.advance(4_999)
    h.spawn.of('postgres')[0]?.exit(0)
    expect(await stopping).toEqual({ clean: true })
    expect(h.spawn.of('postgres')[0]?.kills).toEqual([])
  })

  it('kills postgres once the 5 s grace has elapsed', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(0) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const stopping = pg.stop()
    await vi.waitFor(() => expect(h.clock.slept).toContain(5_000))
    h.clock.advance(4_999)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.spawn.of('postgres')[0]?.kills).toEqual([])
    h.clock.advance(1)
    expect(await stopping).toEqual({ clean: false })
    expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1)
  })

  it('does not wait forever and logs an error when postgres survives a kill', async () => {
    await warmCluster()
    const { logger, lines } = recordingLogger()
    const h = harness({ pgCtl: (child) => child.exit(1) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, logger })
    const victim = h.spawn.of('postgres')[0]
    if (victim) victim.onKill = () => {}
    const stopping = pg.stop()
    await vi.waitFor(() => expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1))
    await vi.waitFor(() =>
      expect(h.clock.slept.filter((s) => s === 5_000).length).toBeGreaterThan(0),
    )
    h.clock.advance(5_000)
    expect(await stopping).toEqual({ clean: false })
    expect(lines.some((l) => l.level === 'error' && /did not exit after a kill/.test(l.msg))).toBe(
      true,
    )
  })

  it('kills postgres exactly once even if postgres ignores the first kill and stop is repeated', async () => {
    await warmCluster()
    const h = harness({ pgCtl: (child) => child.exit(1) })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    const victim = h.spawn.of('postgres')[0]
    if (victim) victim.onKill = () => {}
    const first = pg.stop()
    const second = pg.stop()
    await vi.waitFor(() => expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1))
    h.clock.advance(5_000)
    await Promise.all([first, second])
    await pg.stop()
    expect(h.spawn.of('postgres')[0]?.kills).toHaveLength(1)
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('caps a hung pg_ctl at stopTimeoutMs + 5 s, not earlier', async () => {
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
    h.clock.advance(14_999)
    await new Promise((resolve) => setImmediate(resolve))
    expect(h.spawn.of('pg_ctl')[0]?.kills).toEqual([])
    h.clock.advance(1)
    expect(await stopping).toEqual({ clean: false })
    expect(h.spawn.of('pg_ctl')[0]?.kills).toHaveLength(1)
  })
})

describe('start: readiness', () => {
  it('times out after exactly startTimeoutMs of polling at the poll interval', async () => {
    await warmCluster()
    const h = harness({ probe: async () => 'not_ready' })
    await expect(
      startEmbeddedPostgres({
        pgRoot,
        dataRoot,
        deps: h.deps,
        startTimeoutMs: 1_000,
        pollIntervalMs: 100,
      }),
    ).rejects.toMatchObject({ code: 'start_timeout' })
    expect(h.probes).toHaveLength(11)
    expect(h.clock.slept.filter((s) => s === 100)).toHaveLength(10)
  })

  it('start_timeout error carries the postgres output tail', async () => {
    await warmCluster()
    const h = harness({
      probe: async () => 'not_ready',
      postgres: (child) => child.stderr.write('LOG:  redo starts at 0/1\n'),
    })
    const err = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      startTimeoutMs: 500,
    }).catch((e: unknown) => e)
    expect((err as { detail?: string }).detail).toContain('redo starts')
  })

  it('reports start_failed (not timeout) when postgres exits in the middle of polling', async () => {
    await warmCluster()
    let calls = 0
    const h = harness({
      probe: async () => {
        calls++
        if (calls === 3) h.spawn.of('postgres')[0]?.exit(1)
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
        return 'not_ready'
      },
    })
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'start_failed',
    })
    expect(calls).toBe(3)
    expect(h.spawn.of('postgres')).toHaveLength(1)
  })

  it('does not report ready when postgres exited while the probe was answering', async () => {
    await warmCluster()
    const h = harness({
      probe: async () => {
        h.spawn.of('postgres')[0]?.exit(1)
        await new Promise((resolve) => setImmediate(resolve))
        await new Promise((resolve) => setImmediate(resolve))
        return 'ready'
      },
    })
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'start_failed',
    })
  })

  it('names the signal when postgres is killed during startup', async () => {
    await warmCluster()
    const h = harness({ postgres: (child) => child.exit(null, 'SIGKILL') })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'start_failed' })
    expect((err as Error).message).toContain('SIGKILL')
  })

  it('stops postgres and reports start_failed when creating the database fails', async () => {
    await warmCluster()
    const h = harness({
      ensureDatabase: async () => {
        throw new Error('permission denied to create database')
      },
    })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect(err).toMatchObject({ code: 'start_failed' })
    expect((err as Error).message).toContain('permission denied')
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
    expect(h.spawn.of('postgres')[0]?.exitCode).toBe(0)
  })

  it('treats an auth rejection followed by an exit within the grace window on a free port as start_failed', async () => {
    await warmCluster()
    const h = harness({
      probe: async () => 'auth_failed',
      postgres: (child) => {
        setTimeout(() => child.exit(1), 10)
      },
    })
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, authGraceMs: 5_000 }),
    ).rejects.toMatchObject({ code: 'start_failed' })
  })

  it('does not retry a port when postgres died on a port that is still free', async () => {
    await warmCluster()
    const h = harness({ postgres: (child) => child.exit(1) })
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'start_failed',
    })
    expect(h.spawn.of('postgres')).toHaveLength(1)
  })
})

describe('start: port retry exhaustion', () => {
  it('with maxPortAttempts 1 gives up after a single collision', async () => {
    await warmCluster()
    const h = harness({ busy: new Set([6001, 6002]), postgres: (child) => child.exit(1) })
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, maxPortAttempts: 1 }),
    ).rejects.toMatchObject({ code: 'port_unavailable' })
    expect(h.spawn.of('postgres')).toHaveLength(1)
  })

  it('uses a different port on each attempt', async () => {
    await warmCluster()
    const h = harness({ busy: new Set([6001, 6002, 6003]), postgres: (child) => child.exit(1) })
    await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, maxPortAttempts: 3 }).catch(
      () => {},
    )
    const ports = h.spawn.of('postgres').map((c) => c.args[c.args.indexOf('-p') + 1])
    expect(ports).toEqual(['6001', '6002', '6003'])
  })

  it('succeeds on the last allowed attempt', async () => {
    await warmCluster()
    const h = harness({
      busy: new Set([6001, 6002]),
      postgres: (child) => {
        if (child.args.includes('6001') || child.args.includes('6002')) child.exit(1)
      },
    })
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, maxPortAttempts: 3 })
    expect(pg.port).toBe(6003)
    await pg.stop()
  })

  it('port_unavailable carries the output tail of the last attempt', async () => {
    await warmCluster()
    const h = harness({
      busy: new Set([6001, 6002, 6003]),
      postgres: (child) => {
        child.stderr.write(`FATAL:  could not bind ${child.args[3]}\n`)
        child.exit(1)
      },
    })
    const err = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps }).catch(
      (e: unknown) => e,
    )
    expect((err as { detail?: string }).detail).toContain('6003')
  })

  it.each([0, 21, 1.5])('rejects maxPortAttempts %s before spawning anything', async (n) => {
    await warmCluster()
    const h = harness()
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, maxPortAttempts: n }),
    ).rejects.toThrow()
    expect(h.spawn.children).toHaveLength(0)
  })
})

describe('start: option and data-dir validation', () => {
  it.each(['Mawl', 'mawl; drop database x', '1mawl', '', 'a'.repeat(64), 'mäwl', 'ma"wl'])(
    'rejects the database name %j',
    async (database) => {
      await warmCluster()
      const h = harness()
      await expect(
        startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, database }),
      ).rejects.toThrow()
      expect(h.spawn.children).toHaveLength(0)
    },
  )

  it('accepts a 63-character database name', async () => {
    await warmCluster()
    const ensured: string[] = []
    const h = harness({
      ensureDatabase: async (c) => {
        ensured.push(c.database)
      },
    })
    const name = `a${'b'.repeat(62)}`
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, database: name })
    expect(ensured).toEqual([name])
    await pg.stop()
  })

  it.each([
    ['empty pgRoot', { pgRoot: '' }],
    ['empty dataRoot', { dataRoot: '' }],
    ['zero startTimeoutMs', { startTimeoutMs: 0 }],
    ['negative stopTimeoutMs', { stopTimeoutMs: -1 }],
  ])('rejects %s', async (_name, override) => {
    const h = harness()
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, ...override }),
    ).rejects.toThrow()
    expect(h.spawn.children).toHaveLength(0)
  })

  it.each([
    ['a malformed password file', 'short'],
    ['a password with a bad alphabet', `${'!'.repeat(43)}`],
    ['an empty password file', ''],
  ])('refuses to start with %s and never runs initdb over the cluster', async (_n, content) => {
    await warmCluster()
    await writeFile(join(dataRoot, PASSWORD_FILE), content)
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
    expect(h.spawn.children).toHaveLength(0)
  })

  it('refuses a missing password file next to a valid cluster', async () => {
    await warmCluster()
    await rm(join(dataRoot, PASSWORD_FILE))
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
    expect(h.spawn.of('initdb')).toHaveLength(0)
  })

  it('refuses a cluster from another Postgres major', async () => {
    await warmCluster()
    await writeFile(join(dataRoot, CLUSTER_DIR, 'PG_VERSION'), '16\n')
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
  })

  it('refuses a cluster path that is a file', async () => {
    await mkdir(dataRoot, { recursive: true })
    await writeFile(join(dataRoot, CLUSTER_DIR), 'not a dir')
    const h = harness()
    await expect(startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })).rejects.toMatchObject({
      code: 'data_dir_corrupt',
    })
    expect(h.spawn.children).toHaveLength(0)
  })

  it('does not start postgres when the cold initdb fails', async () => {
    const h = harness()
    const failing = fakeSpawn({
      initdb: (child) => child.exit(2),
      postgres: runningPostgres,
      pg_ctl: (child) => child.exit(0),
    })
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: { ...h.deps, spawn: failing.spawn } }),
    ).rejects.toMatchObject({ code: 'initdb_failed' })
    expect(failing.of('postgres')).toHaveLength(0)
  })
})

describe('stale artifacts', () => {
  it('start removes staging dirs and pwfiles from a crashed first run but keeps the cluster', async () => {
    await warmCluster()
    await mkdir(join(dataRoot, `${STAGING_PREFIX}abc`, 'global'), { recursive: true })
    await writeFile(join(dataRoot, `${STAGING_PREFIX}abc`, 'global', 'x'), 'x')
    await writeFile(join(dataRoot, `${PWFILE_PREFIX}abc`), 'secret')
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    await pg.stop()
    expect((await readdir(dataRoot)).sort()).toEqual([CLUSTER_DIR, PASSWORD_FILE].sort())
  })

  it('removeStaleArtifacts leaves unrelated files alone, including near-miss names', async () => {
    await mkdir(dataRoot, { recursive: true })
    await writeFile(join(dataRoot, 'cluster.staging'), 'keep')
    await writeFile(join(dataRoot, 'cluster'), 'keep')
    await writeFile(join(dataRoot, 'initdb-pw-x'), 'keep')
    await writeFile(join(dataRoot, `${PWFILE_PREFIX}x`), 'drop')
    await removeStaleArtifacts(dataRoot)
    expect((await readdir(dataRoot)).sort()).toEqual(['cluster', 'cluster.staging', 'initdb-pw-x'])
  })

  it('removeStaleArtifacts tolerates a data root that does not exist', async () => {
    await expect(removeStaleArtifacts(join(root, 'nope'))).resolves.toBeUndefined()
  })

  it('a stale staging dir does not block a cold start', async () => {
    await mkdir(join(dataRoot, `${STAGING_PREFIX}dead`), { recursive: true })
    await writeFile(join(dataRoot, `${STAGING_PREFIX}dead`, 'PG_VERSION'), '17\n')
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    expect(pg.cold).toBe(true)
    expect((await readdir(dataRoot)).sort()).toEqual([CLUSTER_DIR, PASSWORD_FILE].sort())
    await pg.stop()
  })
})

describe('initCluster: rename retries', () => {
  const run = (rename_: (a: string, b: string) => Promise<void>, clock = fakeClock()) =>
    initCluster({
      pgRoot,
      dataRoot,
      spawn: fakeSpawn({ initdb: fakeInitdbOk() }).spawn,
      clock,
      rename: rename_,
    })

  it('tries the rename 8 times in total and backs off 50, 100, 200, 400, 800, 1000, 1000 ms', async () => {
    let calls = 0
    const clock = fakeClock()
    await run(async () => {
      calls++
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
    }, clock).catch(() => {})
    expect(calls).toBe(8)
    expect(clock.slept.filter((s) => s <= 1_000)).toEqual([50, 100, 200, 400, 800, 1_000, 1_000])
  })

  it('succeeds on the final (8th) attempt', async () => {
    let calls = 0
    await run(async (from, to) => {
      calls++
      if (calls < 8) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
      await rename(from, to)
    })
    expect(calls).toBe(8)
    expect((await readdir(dataRoot)).sort()).toEqual([CLUSTER_DIR, PASSWORD_FILE].sort())
  })

  it.each(['EPERM', 'EACCES', 'EBUSY'])('retries %s', async (code) => {
    let calls = 0
    await run(async (from, to) => {
      if (++calls < 2) throw Object.assign(new Error(code), { code })
      await rename(from, to)
    })
    expect(calls).toBe(2)
  })

  it.each(['ENOENT', 'ENOSPC', 'EXDEV', 'EEXIST'])(
    'fails at once on %s without retrying',
    async (code) => {
      let calls = 0
      const clock = fakeClock()
      const err = await run(async () => {
        calls++
        throw Object.assign(new Error(code), { code })
      }, clock).catch((e: unknown) => e)
      expect(err).toMatchObject({ code: 'initdb_failed' })
      expect((err as Error).message).toContain(code)
      expect(calls).toBe(1)
      expect(clock.slept.filter((s) => s <= 1_000)).toEqual([])
    },
  )

  it('fails at once on an error with no code and still cleans up', async () => {
    let calls = 0
    const err = await run(async () => {
      calls++
      throw new Error('boom')
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'initdb_failed' })
    expect(calls).toBe(1)
    expect((await readdir(dataRoot)).filter((n) => n.startsWith(STAGING_PREFIX))).toEqual([])
  })

  it('leaves no cluster, so the next boot runs initdb again, after a failed rename', async () => {
    await run(transient('EPERM')).catch(() => {})
    const names = await readdir(dataRoot)
    expect(names).not.toContain(CLUSTER_DIR)
    expect(names.filter((n) => n.startsWith(PWFILE_PREFIX))).toEqual([])
  })
})
