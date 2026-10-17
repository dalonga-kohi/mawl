import { randomBytes } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const MASTER_KEY_FILE = 'master.key'
export const MASTER_KEY_BYTES = 32

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code

async function readKey(file: string): Promise<Uint8Array> {
  const bytes = await readFile(file)
  if (bytes.length !== MASTER_KEY_BYTES) {
    // Never repair or replace: a new key would orphan every secret already stored.
    throw new Error(
      `Master key file ${file} must be exactly ${MASTER_KEY_BYTES} bytes (found ${bytes.length}). ` +
        'Restore it from backup; Faire will not overwrite it.',
    )
  }
  return new Uint8Array(bytes)
}

/** Writes `data` to `file` with flag wx (fails with EEXIST), mode 0600, and fsyncs it. */
async function writeExclusive(file: string, data: Uint8Array): Promise<void> {
  const handle = await open(file, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * Returns the master key in `dir`, creating `master.key` (32 random bytes, 0600) on first boot.
 *
 * Creation is atomic and race-safe: the key is fully written to a private temp file, then
 * hard-linked to its final name, which fails with EEXIST if another boot won. Readers therefore
 * never see a partial file. An existing file is never overwritten, whatever its content.
 */
export async function loadOrCreateMasterKey(dir: string): Promise<Uint8Array> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, MASTER_KEY_FILE)
  const tmp = join(dir, `.${MASTER_KEY_FILE}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const fresh = new Uint8Array(randomBytes(MASTER_KEY_BYTES))
  try {
    await writeExclusive(tmp, fresh)
    try {
      await link(tmp, file)
    } catch (e) {
      if (code(e) === 'EEXIST') return await readKey(file)
      // Filesystem without hard links: fall back to a direct exclusive create.
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(e) ?? '')) throw e
      try {
        await writeExclusive(file, fresh)
      } catch (e2) {
        if (code(e2) === 'EEXIST') return await readKey(file)
        throw e2
      }
    }
    return await readKey(file)
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
