import { mkdir, mkdtemp, rm, truncate, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkInstallerSize, findInstallers, INSTALLER_BUDGET_BYTES } from './size-budget.ts'

const MiB = 1024 * 1024

describe('the installer size budget', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mawl-size-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function fakeFile(name: string, bytes: number): Promise<string> {
    const path = join(dir, name)
    await writeFile(path, '')
    // Sparse on NTFS and ext4: no real 60 MiB write.
    await truncate(path, bytes)
    return path
  }

  it('is 60 MiB (D0.2 measured 46.35 MiB)', () => {
    expect(INSTALLER_BUDGET_BYTES).toBe(60 * MiB)
  })

  it('passes an installer at the budget and fails one a byte over it', async () => {
    const at = await checkInstallerSize(await fakeFile('at.exe', 60 * MiB))
    expect(at).toMatchObject({ ok: true, bytes: 60 * MiB })
    const over = await checkInstallerSize(await fakeFile('over.exe', 60 * MiB + 1))
    expect(over.ok).toBe(false)
    expect(over.message).toMatch(/over\.exe is 60\.00 MiB, over the 60 MiB budget/)
  })

  it('reports the size of a small installer', async () => {
    const small = await checkInstallerSize(await fakeFile('Mawl_0.0.0_x64-setup.exe', 46 * MiB))
    expect(small.ok).toBe(true)
    expect(small.message).toMatch(/46\.00 MiB of 60 MiB/)
  })

  it('finds the NSIS setup executables under a bundle dir', async () => {
    await mkdir(join(dir, 'nsis'), { recursive: true })
    await fakeFile('nsis/Mawl_0.0.0_x64-setup.exe', 10)
    await fakeFile('nsis/notes.txt', 10)
    expect(await findInstallers(dir)).toEqual([join(dir, 'nsis', 'Mawl_0.0.0_x64-setup.exe')])
    expect(await findInstallers(join(dir, 'missing'))).toEqual([])
  })
})
