import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLUSTER_DIR,
  initCluster,
  inspectCluster,
  PASSWORD_FILE,
  PWFILE_PREFIX,
  passwordSchema,
  STAGING_PREFIX,
} from './cluster.ts'
import { argValue, fakeClock, fakeInitdbOk, fakeSpawn } from './fakes.ts'

let root = ''
const pgRoot = join('C:', 'pg')
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mawl-epg-init-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('initCluster', () => {
  it('runs initdb into a staging dir and renames a finished cluster into place', async () => {
    const seen: { password?: string } = {}
    const fake = fakeSpawn({ initdb: fakeInitdbOk(seen) })
    const password = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
    })

    expect(passwordSchema.safeParse(password).success).toBe(true)
    expect(seen.password).toBe(password)
    expect(await inspectCluster(root)).toEqual({ state: 'valid', password })
    // Nothing left over: no staging dir, no pwfile.
    expect((await readdir(root)).sort()).toEqual([CLUSTER_DIR, PASSWORD_FILE].sort())

    const [initdb] = fake.of('initdb')
    expect(argValue(initdb?.args ?? [], '--pgdata')).toContain(STAGING_PREFIX)
    expect(initdb?.args).toEqual(
      expect.arrayContaining(['--no-sync', '--auth=scram-sha-256', '--username=mawl']),
    )
    expect(initdb?.opts.stdio).toEqual(['ignore', 'pipe', 'pipe'])
    expect(initdb?.opts).not.toHaveProperty('detached', true)
  })

  it('never passes the password on the command line', async () => {
    const fake = fakeSpawn({ initdb: fakeInitdbOk() })
    const password = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
    })
    expect(fake.of('initdb')[0]?.args.join(' ')).not.toContain(password)
  })

  it('creates the data root when it does not exist yet', async () => {
    const nested = join(root, 'a', 'b')
    const fake = fakeSpawn({ initdb: fakeInitdbOk() })
    await initCluster({ pgRoot, dataRoot: nested, spawn: fake.spawn, clock: fakeClock() })
    expect((await inspectCluster(nested)).state).toBe('valid')
  })

  it('removes stale staging dirs and pwfiles left by a crashed first run', async () => {
    await mkdir(join(root, `${STAGING_PREFIX}dead`, 'global'), { recursive: true })
    await writeFile(join(root, `${STAGING_PREFIX}dead`, 'PG_VERSION'), '17\n')
    await writeFile(join(root, `${PWFILE_PREFIX}dead`), 'old')
    const fake = fakeSpawn({ initdb: fakeInitdbOk() })
    await initCluster({ pgRoot, dataRoot: root, spawn: fake.spawn, clock: fakeClock() })
    expect((await readdir(root)).sort()).toEqual([CLUSTER_DIR, PASSWORD_FILE].sort())
  })

  it('fails with initdb_failed and leaves nothing behind when initdb exits non-zero', async () => {
    const fake = fakeSpawn({
      initdb: (child) => {
        void mkdir(argValue(child.args, '--pgdata') ?? '', { recursive: true }).then(() => {
          child.stderr.write('initdb: error: something broke\n')
          child.exit(1)
        })
      },
    })
    const err = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'initdb_failed' })
    expect((err as { detail?: string }).detail).toContain('something broke')
    expect(await readdir(root)).toEqual([])
  })

  it('fails with initdb_failed when initdb cannot be spawned', async () => {
    const fake = fakeSpawn({
      initdb: (child) => {
        setImmediate(() => child.emit('error', new Error('spawn initdb.exe ENOENT')))
      },
    })
    const err = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'initdb_failed' })
    expect(await readdir(root)).toEqual([])
  })

  it('kills a hung initdb at the timeout and fails with initdb_failed', async () => {
    const clock = fakeClock()
    const fake = fakeSpawn({ initdb: () => {} })
    const pending = initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock,
      initdbTimeoutMs: 120_000,
    }).catch((e: unknown) => e)
    await vi.waitFor(() => expect(fake.of('initdb')).toHaveLength(1))
    clock.advance(120_000)
    const err = await pending
    expect(err).toMatchObject({ code: 'initdb_failed' })
    expect(fake.of('initdb')[0]?.kills.length).toBeGreaterThan(0)
    expect(await readdir(root)).toEqual([])
  })

  it('retries the rename while Windows holds the staging dir (EPERM), then succeeds', async () => {
    const fake = fakeSpawn({ initdb: fakeInitdbOk() })
    let calls = 0
    const flaky = async (from: string, to: string) => {
      calls++
      if (calls < 3)
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' })
      await rename(from, to)
    }
    const password = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
      rename: flaky,
    })
    expect(calls).toBe(3)
    expect(await inspectCluster(root)).toEqual({ state: 'valid', password })
  })

  it('gives up on a rename that keeps failing and cleans up the staging dir', async () => {
    const fake = fakeSpawn({ initdb: fakeInitdbOk() })
    const err = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fake.spawn,
      clock: fakeClock(),
      rename: async () => {
        throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
      },
    }).catch((e: unknown) => e)
    expect(err).toMatchObject({ code: 'initdb_failed' })
    expect(await inspectCluster(root)).toEqual({ state: 'absent' })
    expect((await readdir(root)).filter((n) => n.startsWith(STAGING_PREFIX))).toEqual([])
  })

  it('writes a fresh password on every first run', async () => {
    const a = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fakeSpawn({ initdb: fakeInitdbOk() }).spawn,
      clock: fakeClock(),
    })
    await rm(join(root, CLUSTER_DIR), { recursive: true })
    const b = await initCluster({
      pgRoot,
      dataRoot: root,
      spawn: fakeSpawn({ initdb: fakeInitdbOk() }).spawn,
      clock: fakeClock(),
    })
    expect(a).not.toBe(b)
    expect((await readFile(join(root, PASSWORD_FILE), 'utf8')).trim()).toBe(b)
  })
})
