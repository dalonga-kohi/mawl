import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HOST_ID_FILE, HostIdError, loadOrCreateHostId } from './host-id.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-hostid-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const URN_UUID_V4 = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('loadOrCreateHostId', () => {
  it('creates an opaque urn:uuid v4 id on first boot, in the secrets dir', async () => {
    const id = await loadOrCreateHostId(join(dir, 'secrets'))
    expect(id).toMatch(URN_UUID_V4)
    expect(await readFile(join(dir, 'secrets', HOST_ID_FILE), 'utf8')).toBe(`${id}\n`)
  })

  it('returns the same id on every later boot', async () => {
    const first = await loadOrCreateHostId(dir)
    expect(await loadOrCreateHostId(dir)).toBe(first)
    expect(await loadOrCreateHostId(dir)).toBe(first)
  })

  it('agrees on one id when many boots race', async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateHostId(dir)))
    expect(new Set(ids).size).toBe(1)
  })

  it('never overwrites a file it cannot read as a host id', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, HOST_ID_FILE), 'not-an-id\n')
    await expect(loadOrCreateHostId(dir)).rejects.toBeInstanceOf(HostIdError)
    expect(await readFile(join(dir, HOST_ID_FILE), 'utf8')).toBe('not-an-id\n')
  })

  it('leaves no temp files behind', async () => {
    await loadOrCreateHostId(dir)
    expect(await readdir(dir)).toEqual([HOST_ID_FILE])
  })

  it('does not derive from anything user identifying: two servers get different ids', async () => {
    const other = await mkdtemp(join(tmpdir(), 'mawl-hostid-'))
    try {
      expect(await loadOrCreateHostId(other)).not.toBe(await loadOrCreateHostId(dir))
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })
})
