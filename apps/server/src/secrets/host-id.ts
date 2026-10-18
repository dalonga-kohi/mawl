import { randomUUID } from 'node:crypto'
import { link, mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'

export const HOST_ID_FILE = 'siwc-host-id'

const FORMAT = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The host id file exists but does not hold a host id. It is never replaced. */
export class HostIdError extends Error {
  constructor(file: string) {
    super(
      `Host id file ${file} does not contain a urn:uuid id. Remove it only if no sign-in was made.`,
    )
    this.name = 'HostIdError'
  }
}

const code = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code

async function read(file: string): Promise<string> {
  const id = (await readFile(file, 'utf8')).trim()
  if (!FORMAT.test(id)) throw new HostIdError(file)
  return id
}

/**
 * The opaque `ext_agent_host_id` for Sign in with ChatGPT: one `urn:uuid:<v4>` per server,
 * created on first boot next to the master key and reused for every sign-in. It is random, never
 * derived from the owner or the machine. Creation is race-safe: the id is written to a private
 * temp file and hard-linked to its name, so a reader never sees a partial file, and an existing
 * file is never replaced.
 */
export async function loadOrCreateHostId(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, HOST_ID_FILE)
  const tmp = join(dir, `.${HOST_ID_FILE}.${process.pid}.${randomUUID()}.tmp`)
  const fresh = `urn:uuid:${randomUUID()}`
  const handle = await open(tmp, 'wx', 0o600)
  try {
    await handle.writeFile(`${fresh}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  try {
    await link(tmp, file)
    return fresh
  } catch (e) {
    if (code(e) === 'EEXIST') return await read(file)
    // No hard links on this filesystem: fall back to an exclusive create.
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(e) ?? '')) throw e
    try {
      const direct = await open(file, 'wx', 0o600)
      try {
        await direct.writeFile(`${fresh}\n`)
        await direct.sync()
      } finally {
        await direct.close()
      }
      return fresh
    } catch (e2) {
      if (code(e2) !== 'EEXIST') throw e2
      return await read(file)
    }
  } finally {
    await unlink(tmp).catch(() => {})
  }
}
