import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  binaryPath,
  CLUSTER_DIR,
  inspectCluster,
  PASSWORD_FILE,
  requireBinaries,
} from './cluster.ts'
import { EmbeddedPgError } from './errors.ts'

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'mawl-epg-cluster-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function fakeBinaries(dir: string, names: string[]) {
  await mkdir(join(dir, 'bin'), { recursive: true })
  for (const n of names) await writeFile(binaryPath(dir, n), '')
}

async function fakeCluster(dir: string, version = '17') {
  await mkdir(join(dir, 'global'), { recursive: true })
  await writeFile(join(dir, 'PG_VERSION'), `${version}\n`)
  await writeFile(join(dir, 'global', 'pg_control'), 'x')
  await writeFile(join(dir, 'postgresql.conf'), '')
}

describe('requireBinaries', () => {
  it('passes when initdb, postgres and pg_ctl are present', async () => {
    await fakeBinaries(root, ['initdb', 'postgres', 'pg_ctl'])
    await expect(requireBinaries(root)).resolves.toBeUndefined()
  })

  it('fails with binaries_missing naming the missing binary', async () => {
    await fakeBinaries(root, ['initdb', 'postgres'])
    const err = await requireBinaries(root).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EmbeddedPgError)
    expect(err).toMatchObject({ code: 'binaries_missing' })
    expect((err as Error).message).toContain('pg_ctl')
  })
})

describe('inspectCluster', () => {
  it('reports a missing cluster dir as absent', async () => {
    expect(await inspectCluster(root)).toEqual({ state: 'absent' })
  })

  it('reports a complete PG 17 cluster with its password as valid', async () => {
    await fakeCluster(join(root, CLUSTER_DIR))
    await writeFile(join(root, PASSWORD_FILE), 'p'.repeat(43))
    expect(await inspectCluster(root)).toEqual({ state: 'valid', password: 'p'.repeat(43) })
  })

  it.each([
    ['PG_VERSION', 'PG_VERSION'],
    ['global/pg_control', join('global', 'pg_control')],
    ['postgresql.conf', 'postgresql.conf'],
  ])('reports a cluster without %s as corrupt', async (_label, file) => {
    await fakeCluster(join(root, CLUSTER_DIR))
    await writeFile(join(root, PASSWORD_FILE), 'p'.repeat(43))
    await rm(join(root, CLUSTER_DIR, file))
    expect(await inspectCluster(root)).toMatchObject({ state: 'corrupt' })
  })

  it('reports an empty cluster dir as corrupt, never as absent', async () => {
    await mkdir(join(root, CLUSTER_DIR))
    expect(await inspectCluster(root)).toMatchObject({ state: 'corrupt' })
  })

  it('reports a cluster from another major version as corrupt with the version', async () => {
    await fakeCluster(join(root, CLUSTER_DIR), '16')
    await writeFile(join(root, PASSWORD_FILE), 'p'.repeat(43))
    const r = await inspectCluster(root)
    expect(r).toMatchObject({ state: 'corrupt' })
    expect(r.state === 'corrupt' && r.reason).toContain('16')
  })

  it('reports a cluster whose password file is missing or malformed as corrupt', async () => {
    await fakeCluster(join(root, CLUSTER_DIR))
    expect(await inspectCluster(root)).toMatchObject({ state: 'corrupt' })
    await writeFile(join(root, PASSWORD_FILE), 'short')
    expect(await inspectCluster(root)).toMatchObject({ state: 'corrupt' })
  })

  it('never puts the password in a corrupt reason', async () => {
    await fakeCluster(join(root, CLUSTER_DIR), '16')
    await writeFile(join(root, PASSWORD_FILE), 'p'.repeat(43))
    const r = await inspectCluster(root)
    expect(JSON.stringify(r)).not.toContain('p'.repeat(43))
  })
})
