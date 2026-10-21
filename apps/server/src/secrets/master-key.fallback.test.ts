import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hard links unavailable (e.g. some network or FAT mounts): exercise the direct-create fallback.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    link: vi.fn(async () => {
      throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' })
    }),
  }
})

const { loadOrCreateMasterKey } = await import('./master-key.ts')

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-key-fb-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('loadOrCreateMasterKey without hard links', () => {
  it('creates a 32 byte key via the fallback', async () => {
    const key = await loadOrCreateMasterKey(dir)
    expect(key.length).toBe(32)
    expect((await readFile(join(dir, 'master.key'))).equals(Buffer.from(key))).toBe(true)
  })

  it('ends with one key when first boots race', async () => {
    const keys = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateMasterKey(dir)))
    for (const k of keys) {
      expect(Buffer.from(k).equals(Buffer.from(keys[0] as Uint8Array))).toBe(true)
    }
  })

  it('waits briefly for a writer that created the file but has not finished it', async () => {
    const file = join(dir, 'master.key')
    await writeFile(file, '')
    const real = Buffer.alloc(32, 3)
    setTimeout(() => void writeFile(file, real), 40)
    const key = await loadOrCreateMasterKey(dir)
    expect(Buffer.from(key).equals(real)).toBe(true)
  })

  it('still refuses a file that stays short, and leaves it alone', async () => {
    const file = join(dir, 'master.key')
    await writeFile(file, Buffer.alloc(5, 1))
    await expect(loadOrCreateMasterKey(dir)).rejects.toThrow(/exactly 32 bytes/)
    expect((await readFile(file)).length).toBe(5)
  })
})
