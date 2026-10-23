import { getEventListeners } from 'node:events'
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

describe('onSpawn and abort edges', () => {
  const never: EmbeddedPgDeps['probe'] = () => new Promise<ProbeResult>(() => {})

  it('an abort during ensureDatabase stops postgres and rejects with aborted', async () => {
    await warmCluster()
    const h = harness()
    const controller = new AbortController()
    h.deps.ensureDatabase = async () => {
      controller.abort()
      await new Promise((resolve) => setImmediate(resolve))
    }
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'EmbeddedPgError', code: 'aborted' })
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
    expect(h.spawn.of('postgres')[0]?.exitCode).toBe(0)
  })

  it('an abort fired inside onSpawn stops that postgres before any probe', async () => {
    await warmCluster()
    const probe = vi.fn(never)
    const h = harness({ probe })
    const controller = new AbortController()
    await expect(
      startEmbeddedPostgres({
        pgRoot,
        dataRoot,
        deps: h.deps,
        signal: controller.signal,
        onSpawn: () => controller.abort(),
      }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(h.spawn.of('postgres')).toHaveLength(1)
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('the emergency stop is idempotent and shared with an abort', async () => {
    await warmCluster()
    const h = harness({ probe: never })
    const controller = new AbortController()
    const stops: (() => Promise<{ clean: boolean }>)[] = []
    const starting = startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      signal: controller.signal,
      onSpawn: (stop) => stops.push(stop),
    }).catch((err: unknown) => err)
    await vi.waitFor(() => expect(stops).toHaveLength(1))
    const first = stops[0]?.()
    const second = stops[0]?.()
    controller.abort()
    controller.abort()
    expect(await first).toEqual({ clean: true })
    expect(await second).toEqual({ clean: true })
    expect(await starting).toBeDefined()
    // One pg_ctl for the emergency stop, the abort, and the repeated calls together.
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('an onSpawn that throws still stops the spawned postgres', async () => {
    await warmCluster()
    const h = harness({ probe: never })
    await expect(
      startEmbeddedPostgres({
        pgRoot,
        dataRoot,
        deps: h.deps,
        onSpawn: () => {
          throw new Error('registry full')
        },
      }),
    ).rejects.toMatchObject({ code: 'start_failed' })
    expect(h.spawn.of('postgres')).toHaveLength(1)
    expect(h.spawn.of('postgres')[0]?.exitCode).toBe(0)
  })

  it('an abort wakes a long poll sleep, it does not wait for the interval', async () => {
    await warmCluster()
    const h = harness({ probe: async () => 'not_ready' })
    const controller = new AbortController()
    const starting = startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      pollIntervalMs: 600_000,
      signal: controller.signal,
    }).catch((err: unknown) => err)
    // The fake clock leaves the 10-minute sleep pending until the test advances time.
    await vi.waitFor(() => expect(h.clock.slept).toContain(600_000))
    controller.abort()
    expect(await starting).toMatchObject({ code: 'aborted' })
    expect(h.spawn.of('postgres')[0]?.exitCode).toBe(0)
  })

  it('removes its abort listener after a start that finished', async () => {
    await warmCluster()
    const h = harness()
    const controller = new AbortController()
    const pg = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      signal: controller.signal,
    })
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
    await pg.stop()
  })

  it('removes its abort listener after an aborted start too', async () => {
    await warmCluster()
    const h = harness({ probe: never })
    const controller = new AbortController()
    const starting = startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      signal: controller.signal,
    }).catch((err: unknown) => err)
    await vi.waitFor(() => expect(h.spawn.of('postgres')).toHaveLength(1))
    controller.abort()
    await starting
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0)
  })

  it('an abort at the same time as a postgres crash settles with an EmbeddedPgError', async () => {
    await warmCluster()
    const h = harness({
      probe: never,
      postgres: (child) => {
        child.exit(1)
      },
    })
    const controller = new AbortController()
    const starting = startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      signal: controller.signal,
    }).catch((err: unknown) => err)
    controller.abort()
    const err = await starting
    expect(err).toMatchObject({ name: 'EmbeddedPgError' })
    expect(['aborted', 'start_failed']).toContain((err as { code: string }).code)
  })

  it('a stop used as the emergency stop after ready marks the exit as expected', async () => {
    await warmCluster()
    const h = harness()
    const stops: (() => Promise<{ clean: boolean }>)[] = []
    const pg = await startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      onSpawn: (stop) => stops.push(stop),
    })
    await stops[0]?.()
    expect((await pg.exited).expected).toBe(true)
    // The handle's stop is the same promise: no second pg_ctl.
    await pg.stop()
    expect(h.spawn.of('pg_ctl')).toHaveLength(1)
  })

  it('an unexpected exit is not marked expected when no stop was requested', async () => {
    await warmCluster()
    const h = harness()
    const pg = await startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps })
    h.spawn.of('postgres')[0]?.exit(1)
    expect((await pg.exited).expected).toBe(false)
  })

  it('an aborted signal with a custom reason still rejects as aborted', async () => {
    await warmCluster()
    const h = harness()
    const controller = new AbortController()
    controller.abort(new Error('window closed'))
    await expect(
      startEmbeddedPostgres({ pgRoot, dataRoot, deps: h.deps, signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(h.spawn.children).toHaveLength(0)
  })

  it('an abort during a port-race retry starts no third postgres', async () => {
    await warmCluster()
    const controller = new AbortController()
    let spawned = 0
    const h = harness({
      busy: new Set([5501]),
      probe: never,
      postgres: (child) => {
        spawned++
        if (spawned === 1) child.exit(1)
      },
    })
    const starting = startEmbeddedPostgres({
      pgRoot,
      dataRoot,
      deps: h.deps,
      signal: controller.signal,
      onSpawn: () => {
        if (spawned >= 1) queueMicrotask(() => controller.abort())
      },
    }).catch((err: unknown) => err)
    expect(await starting).toMatchObject({ name: 'EmbeddedPgError' })
    expect(h.spawn.of('postgres').length).toBeLessThanOrEqual(2)
  })
})
