import { randomBytes, randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { AUTH_TOKEN_PATTERN } from '@mawl/contracts'

export const OWNER_TOKEN_FILE = 'owner-token'
const TOKEN_BYTES = 32

/** The owner token file exists but does not hold a token. The message never echoes the content. */
export class OwnerTokenError extends Error {
  constructor(file: string) {
    super(
      `Owner token file ${file} does not contain a token (32-512 base64url characters). ` +
        'Delete it to generate a new one, or set MAWL_OWNER_TOKEN.',
    )
    this.name = 'OwnerTokenError'
  }
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code

async function read(file: string): Promise<string> {
  const token = (await readFile(file, 'utf8')).trim()
  if (!AUTH_TOKEN_PATTERN.test(token)) throw new OwnerTokenError(file)
  return token
}

async function writeExclusive(file: string, content: string): Promise<void> {
  const handle = await open(file, 'wx', 0o600)
  try {
    await handle.writeFile(content)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

/**
 * The headless owner token (until device auth, D8.1): 32 random bytes as base64url, created on
 * first boot as `owner-token` next to the master key (mode 0600) and reused afterwards. `created`
 * is true only for the boot that wrote it, so the server can show it once. Creation is race-safe
 * like the host id: a private temp file hard-linked to its name, so a reader never sees a partial
 * file and an existing file is never replaced.
 */
export async function loadOrCreateOwnerToken(
  dir: string,
): Promise<{ token: string; created: boolean }> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, OWNER_TOKEN_FILE)
  const tmp = join(dir, `.${OWNER_TOKEN_FILE}.${process.pid}.${randomUUID()}.tmp`)
  const fresh = randomBytes(TOKEN_BYTES).toString('base64url')
  await writeExclusive(tmp, `${fresh}\n`)
  try {
    await link(tmp, file)
    return { token: fresh, created: true }
  } catch (e) {
    if (code(e) === 'EEXIST') return { token: await read(file), created: false }
    // No hard links on this filesystem: fall back to an exclusive create.
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(e) ?? '')) throw e
    try {
      await writeExclusive(file, `${fresh}\n`)
      return { token: fresh, created: true }
    } catch (e2) {
      if (code(e2) !== 'EEXIST') throw e2
      return { token: await read(file), created: false }
    }
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
