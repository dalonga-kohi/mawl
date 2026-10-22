import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateDbOptions, DbHandle } from '@mawl/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { createLogger } from './logger.ts'
import { HostMasterKey, MasterKeyError, matchingKeyFile } from './secrets/index.ts'
import { startServer } from './server.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-hostkey-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fakes() {
  const close = vi.fn(async () => {})
  const handle = {
    db: {},
    pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
    close,
  } as unknown as DbHandle
  const createDb = vi.fn((_url: string, _options?: CreateDbOptions) => handle)
  return {
    close,
    migrate: vi.fn(async () => {}),
    createDb,
    worker: false as const,
    events: false as const,
  }
}

const desktop = (): Config => ({
  databaseUrl: 'postgres://mawl:s3cr3t-pw@db/mawl',
  host: '127.0.0.1',
  port: 0,
  secretsDir: join(dir, 'secrets'),
  siwcPort: 1455,
  siwcHost: '127.0.0.1',
  logLevel: 'silent',
  mode: 'desktop',
  dataDir: dir,
  launchToken: 'launch-token_for-hostkey-edges-0123456789',
})
const silent = () => createLogger({ level: 'silent' })
const keyFile = () => join(dir, 'secrets', 'master.key')
const hostKey = (raw: Buffer) => {
  const bytes = new Uint8Array(raw)
  return { bytes, key: new HostMasterKey(bytes, raw.toString('base64url')) }
}
const writeKeyFile = async (bytes: Buffer) => {
  await mkdir(join(dir, 'secrets'), { recursive: true })
  await writeFile(keyFile(), bytes)
}

describe('startServer with a host master key, edge cases', () => {
  it('rejects an empty master.key (0 bytes) and leaves it', async () => {
    await writeKeyFile(Buffer.alloc(0))
    const f = fakes()
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...f,
        hostMasterKey: hostKey(randomBytes(32)).key,
        verifyMasterKey: async () => 'verified',
      }),
    ).rejects.toThrow(/exactly 32 bytes \(found 0\)/)
    expect((await stat(keyFile())).size).toBe(0)
    expect(f.createDb).not.toHaveBeenCalled()
  })

  it('rejects a 33-byte master.key whose first 32 bytes equal the host key', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(Buffer.concat([raw, Buffer.from([0])]))
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...fakes(),
        hostMasterKey: hostKey(raw).key,
        verifyMasterKey: async () => 'verified',
      }),
    ).rejects.toThrow(/exactly 32 bytes \(found 33\)/)
    expect((await stat(keyFile())).size).toBe(33)
  })

  it('fails boot, not silently, when master.key is unreadable (a directory), and names no key', async () => {
    await mkdir(keyFile(), { recursive: true })
    const raw = randomBytes(32)
    const err = await startServer(desktop(), {
      logger: silent(),
      ...fakes(),
      hostMasterKey: hostKey(raw).key,
      verifyMasterKey: async () => 'verified',
    }).catch((e: unknown) => e as Error)
    expect(err).toBeInstanceOf(Error)
    expect(String((err as Error).message)).not.toContain(raw.toString('base64url'))
    expect((await stat(keyFile())).isDirectory()).toBe(true)
  })

  it('zero-fills the taken key bytes when master.key differs (boot aborted early)', async () => {
    await writeKeyFile(randomBytes(32))
    const { bytes, key } = hostKey(randomBytes(32))
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...fakes(),
        hostMasterKey: key,
        verifyMasterKey: async () => 'verified',
      }),
    ).rejects.toBeInstanceOf(MasterKeyError)
    expect(bytes.every((b) => b === 0)).toBe(true)
  })

  it('zero-fills the taken key bytes when the decrypt check fails', async () => {
    const { bytes, key } = hostKey(randomBytes(32))
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...fakes(),
        hostMasterKey: key,
        verifyMasterKey: async () => {
          throw new Error('db down')
        },
      }),
    ).rejects.toThrow('db down')
    expect(bytes.every((b) => b === 0)).toBe(true)
  })

  it('a non-decrypt failure of the check propagates as is, keeps master.key and closes the db', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const f = fakes()
    const err = await startServer(desktop(), {
      logger: silent(),
      ...f,
      hostMasterKey: hostKey(raw).key,
      verifyMasterKey: async () => {
        throw new Error('connection reset')
      },
    }).catch((e: unknown) => e as Error)
    expect(err).not.toBeInstanceOf(MasterKeyError)
    expect(err.message).toBe('connection reset')
    expect((await readFile(keyFile())).equals(raw)).toBe(true)
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('does not delete master.key when migrations fail before the check', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const f = fakes()
    f.migrate.mockRejectedValueOnce(new Error('migration failed'))
    const verify = vi.fn(async () => 'verified' as const)
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...f,
        hostMasterKey: hostKey(raw).key,
        verifyMasterKey: verify,
      }),
    ).rejects.toThrow('migration failed')
    expect(verify).not.toHaveBeenCalled()
    expect((await readFile(keyFile())).equals(raw)).toBe(true)
  })

  it('a key that was already taken cannot boot a second server', async () => {
    const { key } = hostKey(randomBytes(32))
    const first = await startServer(desktop(), {
      logger: silent(),
      ...fakes(),
      hostMasterKey: key,
      verifyMasterKey: async () => 'empty',
    })
    await first.stop()
    await expect(
      startServer(desktop(), {
        logger: silent(),
        ...fakes(),
        hostMasterKey: key,
        verifyMasterKey: async () => 'empty',
      }),
    ).rejects.toThrow(/already taken/)
  })

  it('a missing master.key at delete time (already gone) does not stop boot', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const server = await startServer(desktop(), {
      logger: silent(),
      ...fakes(),
      hostMasterKey: hostKey(raw).key,
      verifyMasterKey: async () => 'verified',
      unlinkKeyFile: async () => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
      },
    })
    await server.stop()
  })

  it('desktop mode without a host key still uses master.key', async () => {
    const server = await startServer(desktop(), { logger: silent(), ...fakes() }).catch(
      (e: unknown) => e,
    )
    // desktop without a host key still takes the file path (D1.6 only changes the keyed path)
    if (server instanceof Error) throw server
    try {
      expect((await stat(keyFile())).size).toBe(32)
    } finally {
      await (server as { stop(): Promise<void> }).stop()
    }
  })

  it('no log line from a migration carries the key text', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const lines: string[] = []
    const log = createLogger({
      level: 'trace',
      stream: { write: (c: string) => void lines.push(c) },
    })
    const server = await startServer(desktop(), {
      logger: log,
      ...fakes(),
      hostMasterKey: hostKey(raw).key,
      verifyMasterKey: async () => 'verified',
    })
    await server.stop()
    const all = lines.join('')
    expect(all).toContain('master key moved')
    expect(all).not.toContain(raw.toString('base64url'))
    expect(all).not.toContain(raw.toString('hex'))
    expect(all).not.toContain(raw.toString('base64'))
  })
})

describe('matchingKeyFile', () => {
  it('returns undefined when the file is absent', async () => {
    await expect(matchingKeyFile(dir, new Uint8Array(32))).resolves.toBeUndefined()
  })

  it('refuses a host key that is not 32 bytes even if the file matches it', async () => {
    await writeFile(join(dir, 'master.key'), Buffer.alloc(32, 1))
    await expect(matchingKeyFile(dir, new Uint8Array(31).fill(1))).rejects.toBeInstanceOf(
      MasterKeyError,
    )
  })

  it('detects a one-bit difference in the last byte', async () => {
    const raw = randomBytes(32)
    await writeFile(join(dir, 'master.key'), raw)
    const other = new Uint8Array(raw)
    other[31] = (other[31] ?? 0) ^ 1
    await expect(matchingKeyFile(dir, other)).rejects.toThrow(/differs/)
  })

  it('error messages name the file but never key bytes', async () => {
    const raw = randomBytes(32)
    await writeFile(join(dir, 'master.key'), raw)
    const err = await matchingKeyFile(dir, new Uint8Array(randomBytes(32))).catch(
      (e: unknown) => e as Error,
    )
    expect(err.message).toContain('master.key')
    for (const enc of [raw.toString('hex'), raw.toString('base64'), raw.toString('base64url')]) {
      expect(err.message).not.toContain(enc)
    }
  })
})
