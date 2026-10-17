import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOrCreateMasterKey, MasterKeyError } from './master-key.ts'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'faire-key-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('loadOrCreateMasterKey', () => {
  it('creates a 32 byte key (and missing parent dirs) on first boot', async () => {
    const dir = join(root, 'a', 'secrets')
    const key = await loadOrCreateMasterKey(dir)
    expect(key.length).toBe(32)
    expect((await readFile(join(dir, 'master.key'))).equals(Buffer.from(key))).toBe(true)
  })

  it('returns the same key on the next boot', async () => {
    const a = await loadOrCreateMasterKey(root)
    const b = await loadOrCreateMasterKey(root)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })

  it('refuses a key file that is not 32 bytes and leaves it untouched', async () => {
    const file = join(root, 'master.key')
    const bad = Buffer.alloc(31, 7)
    await writeFile(file, bad)
    await expect(loadOrCreateMasterKey(root)).rejects.toThrow(/32 bytes/)
    expect((await readFile(file)).equals(bad)).toBe(true)
  })

  it('refuses an empty key file and leaves it untouched', async () => {
    const file = join(root, 'master.key')
    await writeFile(file, '')
    await expect(loadOrCreateMasterKey(root)).rejects.toThrow(/32 bytes/)
    expect((await readFile(file)).length).toBe(0)
  })

  it('ends with one key when first boots race', async () => {
    const keys = await Promise.all(Array.from({ length: 12 }, () => loadOrCreateMasterKey(root)))
    const first = Buffer.from(keys[0] as Uint8Array)
    for (const k of keys) expect(Buffer.from(k).equals(first)).toBe(true)
    expect((await readFile(join(root, 'master.key'))).equals(first)).toBe(true)
  })

  it('throws MasterKeyError for a wrong-sized file', async () => {
    await writeFile(join(root, 'master.key'), Buffer.alloc(3))
    await expect(loadOrCreateMasterKey(root)).rejects.toBeInstanceOf(MasterKeyError)
  })

  it.skipIf(process.platform === 'win32')('creates the file 0600 and the dir 0700', async () => {
    const dir = join(root, 'sec')
    await loadOrCreateMasterKey(dir)
    expect((await stat(join(dir, 'master.key'))).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
  })

  it.skipIf(process.platform === 'win32')('tightens an existing directory to 0700', async () => {
    await chmod(root, 0o755)
    await loadOrCreateMasterKey(root)
    expect((await stat(root)).mode & 0o777).toBe(0o700)
  })

  it.skipIf(process.platform === 'win32')(
    'warns, but still returns the key, when the key file is group or world readable',
    async () => {
      await loadOrCreateMasterKey(root)
      await chmod(join(root, 'master.key'), 0o644)
      const warnings: string[] = []
      const key = await loadOrCreateMasterKey(root, { onWarning: (m) => warnings.push(m) })
      expect(key.length).toBe(32)
      expect(warnings.join('')).toMatch(/0600/)
    },
  )

  it.skipIf(process.platform === 'win32')('does not warn for a 0600 key', async () => {
    await loadOrCreateMasterKey(root)
    const warnings: string[] = []
    await loadOrCreateMasterKey(root, { onWarning: (m) => warnings.push(m) })
    expect(warnings).toEqual([])
  })
})
