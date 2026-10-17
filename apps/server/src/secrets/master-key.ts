import { randomBytes } from 'node:crypto'
import { chmod, link, mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

export const MASTER_KEY_FILE = 'master.key'
export const MASTER_KEY_BYTES = 32

/** The key file is unusable. The message names the path and size, never key bytes. */
export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MasterKeyError'
  }
}

export interface MasterKeyOptions {
  /** Called for non-fatal problems, e.g. a key file readable by other users. */
  onWarning?: (message: string) => void
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code

const SHORT_READ_RETRIES = 20
const SHORT_READ_DELAY_MS = 10

/**
 * Reads and validates the key. A file shorter than 32 bytes may be another process midway
 * through the fallback create (no hard links), so wait briefly (bounded ~200 ms) before
 * deciding it is corrupt. Never repairs or replaces: a new key would orphan every stored secret.
 */
async function readKey(file: string): Promise<Uint8Array> {
  let bytes = await readFile(file)
  for (let i = 0; i < SHORT_READ_RETRIES && bytes.length < MASTER_KEY_BYTES; i++) {
    await sleep(SHORT_READ_DELAY_MS)
    bytes = await readFile(file)
  }
  if (bytes.length !== MASTER_KEY_BYTES) {
    throw new MasterKeyError(
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
 * POSIX only (Windows relies on the ACL inherited from the user profile): force the directory
 * to 0700 and warn, without refusing, if the key file is readable by group or others.
 */
async function checkPermissions(
  dir: string,
  file: string,
  onWarning: (message: string) => void,
): Promise<void> {
  if (process.platform === 'win32') return
  await chmod(dir, 0o700)
  const { mode } = await stat(file)
  if (mode & 0o077) {
    onWarning(
      `Master key file ${file} has mode ${(mode & 0o777).toString(8)}; expected 0600. Run: chmod 600 ${file}`,
    )
  }
}

/**
 * Returns the master key in `dir`, creating `master.key` (32 random bytes, 0600) on first boot.
 *
 * Creation is atomic and race-safe: the key is fully written to a private temp file, then
 * hard-linked to its final name, which fails with EEXIST if another boot won. Readers therefore
 * never see a partial file. An existing file is never overwritten, whatever its content.
 */
export async function loadOrCreateMasterKey(
  dir: string,
  { onWarning = () => {} }: MasterKeyOptions = {},
): Promise<Uint8Array> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, MASTER_KEY_FILE)
  const tmp = join(dir, `.${MASTER_KEY_FILE}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`)
  const fresh = new Uint8Array(randomBytes(MASTER_KEY_BYTES))
  try {
    const key = await createOrRead(file, tmp, fresh)
    await checkPermissions(dir, file, onWarning)
    return key
  } finally {
    fresh.fill(0)
    await unlink(tmp).catch(() => {})
  }
}

async function createOrRead(file: string, tmp: string, fresh: Uint8Array): Promise<Uint8Array> {
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
      if (code(e2) !== 'EEXIST') throw e2
    }
  }
  return await readKey(file)
}
