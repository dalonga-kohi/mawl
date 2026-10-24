import { randomBytes } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateDbOptions, DbHandle } from '@mawl/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import type { EmbeddedPostgres, PgConnection, StartOptions } from './embedded-pg/index.ts'
import { createLogger } from './logger.ts'
import {
  createSecretBox,
  HOST_ID_FILE,
  HostMasterKey,
  MasterKeyError,
  SecretDecryptError,
} from './secrets/index.ts'
import { OWNER_TOKEN_FILE } from './secrets/owner-token.ts'
import { startServer } from './server.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-boot-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fakes(
  opts: { query?: (...args: unknown[]) => Promise<unknown>; migrate?: () => Promise<void> } = {},
) {
  const close = vi.fn(async () => {})
  const handle = {
    db: {},
    pool: {
      connect: async () => ({ query: opts.query ?? (async () => ({ rows: [] })), release() {} }),
    },
    close,
  } as unknown as DbHandle
  const migrate = vi.fn(opts.migrate ?? (async () => {}))
  const createDb = vi.fn((_url: string, _options?: CreateDbOptions) => handle)
  return { close, migrate, createDb, worker: false as const, events: false as const }
}

const config = (): Config => ({
  databaseUrl: 'postgres://mawl:s3cr3t-pw@db/mawl',
  host: '127.0.0.1',
  port: 0,
  secretsDir: join(dir, 'secrets'),
  siwcPort: 1455,
  siwcHost: '127.0.0.1',
  logLevel: 'silent',
})

const logger = () => createLogger({ level: 'silent' })
const LAUNCH_TOKEN = 'launch-token_for-server-tests-0123456789'

const healthGet = (url: string, token?: string) =>
  fetch(`${url}/rpc/health/get`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: '{}',
  })

describe('startServer auth token', () => {
  it('headless: generates the owner token once, announces it, and requires it on /rpc', async () => {
    const notices: string[] = []
    const announceOwnerToken = (text: string) => void notices.push(text)
    const server = await startServer(config(), { logger: logger(), ...fakes(), announceOwnerToken })
    let token: string
    try {
      token = (await readFile(join(dir, 'secrets', OWNER_TOKEN_FILE), 'utf8')).trim()
      expect(notices).toHaveLength(1)
      expect(notices[0]).toContain(token)
      expect((await healthGet(server.url)).status).toBe(401)
      expect((await healthGet(server.url, `${token}x`)).status).toBe(401)
      expect((await healthGet(server.url, token)).status).toBe(200)
      expect((await fetch(`${server.url}/healthz`)).status).toBe(200)
    } finally {
      await server.stop()
    }
    // A restart reuses it and announces nothing.
    const again = await startServer(config(), { logger: logger(), ...fakes(), announceOwnerToken })
    try {
      expect(notices).toHaveLength(1)
      expect((await healthGet(again.url, token)).status).toBe(200)
    } finally {
      await again.stop()
    }
  })

  it('headless: MAWL_OWNER_TOKEN wins and no token file is written', async () => {
    const ownerToken = 'owner-token_from-env-for-server-tests-012'
    const server = await startServer({ ...config(), ownerToken }, { logger: logger(), ...fakes() })
    try {
      expect((await healthGet(server.url, ownerToken)).status).toBe(200)
      await expect(readFile(join(dir, 'secrets', OWNER_TOKEN_FILE))).rejects.toThrow()
    } finally {
      await server.stop()
    }
  })

  it('desktop: requires the launch token and refuses to boot without one', async () => {
    const desktop: Config = { ...config(), mode: 'desktop', dataDir: dir }
    await expect(startServer(desktop, { logger: logger(), ...fakes() })).rejects.toThrow(
      /launch token/,
    )
    const server = await startServer(
      { ...desktop, launchToken: LAUNCH_TOKEN },
      { logger: logger(), ...fakes() },
    )
    try {
      expect((await healthGet(server.url)).status).toBe(401)
      expect((await healthGet(server.url, LAUNCH_TOKEN)).status).toBe(200)
    } finally {
      await server.stop()
    }
  })
})

describe('startServer', () => {
  it('boots: key, migrations, then serves /healthz and health.get on the chosen port', async () => {
    const f = fakes()
    const server = await startServer(config(), { logger: logger(), ...f })
    try {
      expect(f.migrate).toHaveBeenCalledTimes(1)
      expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      const health = await fetch(`${server.url}/healthz`)
      expect(health.status).toBe(200)
      expect(await health.json()).toEqual({ ok: true })
    } finally {
      await server.stop()
    }
  })

  it('creates the ChatGPT host id next to the master key on first boot and keeps it', async () => {
    const first = await startServer(config(), { logger: logger(), ...fakes() })
    await first.stop()
    const file = join(dir, 'secrets', HOST_ID_FILE)
    const id = await readFile(file, 'utf8')
    expect(id).toMatch(/^urn:uuid:/)
    const second = await startServer(config(), { logger: logger(), ...fakes() })
    await second.stop()
    expect(await readFile(file, 'utf8')).toBe(id)
  })

  it('does not open the database when the host id file is unusable', async () => {
    const f = fakes()
    await mkdir(join(dir, 'secrets'), { recursive: true })
    await writeFile(join(dir, 'secrets', HOST_ID_FILE), 'garbage')
    await expect(startServer(config(), { logger: logger(), ...f })).rejects.toThrow(/host id/i)
    expect(f.createDb).not.toHaveBeenCalled()
  })

  it('reports 503 on /healthz when the database query fails', async () => {
    const f = fakes({
      query: async () => {
        throw new Error('down')
      },
    })
    const server = await startServer(config(), { logger: logger(), ...f })
    try {
      expect((await fetch(`${server.url}/healthz`)).status).toBe(503)
    } finally {
      await server.stop()
    }
  })

  it('stop() closes the listener and the database once, and is idempotent', async () => {
    const f = fakes()
    const server = await startServer(config(), { logger: logger(), ...f })
    await server.stop()
    await server.stop()
    expect(f.close).toHaveBeenCalledTimes(1)
    await expect(fetch(`${server.url}/healthz`)).rejects.toThrow()
  })

  it('stop() does not hang on an open keep-alive connection', async () => {
    const f = fakes()
    const server = await startServer(config(), { logger: logger(), ...f })
    const res = await fetch(`${server.url}/healthz`, { headers: { connection: 'keep-alive' } })
    await res.text()
    await server.stop()
  })

  it('closes the database and rethrows when migrations fail, without leaking the url', async () => {
    const f = fakes({
      migrate: async () => {
        throw new Error('connect ECONNREFUSED 127.0.0.1:5432')
      },
    })
    await expect(startServer(config(), { logger: logger(), ...f })).rejects.toThrow(/ECONNREFUSED/)
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('fails when the port is taken and still closes the database', async () => {
    const f = fakes()
    const first = await startServer(config(), { logger: logger(), ...fakes() })
    try {
      const port = Number(new URL(first.url).port)
      await expect(startServer({ ...config(), port }, { logger: logger(), ...f })).rejects.toThrow(
        /EADDRINUSE/,
      )
      expect(f.close).toHaveBeenCalledTimes(1)
    } finally {
      await first.stop()
    }
  })

  it('creates the master key file on first boot', async () => {
    const server = await startServer(config(), { logger: logger(), ...fakes() })
    try {
      const { readFile } = await import('node:fs/promises')
      expect((await readFile(join(dir, 'secrets', 'master.key'))).length).toBe(32)
    } finally {
      await server.stop()
    }
  })

  it('logs idle pool errors with name and code only', async () => {
    const lines: string[] = []
    const log = createLogger({
      level: 'info',
      stream: { write: (c: string) => void lines.push(c) },
    })
    const f = fakes()
    const server = await startServer(config(), { logger: log, ...f })
    try {
      const onError = f.createDb.mock.calls[0]?.[1]?.onError
      expect(onError).toBeTypeOf('function')
      onError?.(Object.assign(new Error('postgres://u:LEAK-ME@h/d'), { code: '57P01' }))
      const out = lines.join('')
      expect(out).toContain('57P01')
      expect(out).not.toContain('LEAK-ME')
    } finally {
      await server.stop()
    }
  })

  it('probes health through a bounded transaction, not a bare query', async () => {
    const queries: string[] = []
    const f = fakes({
      query: async (...args: unknown[]) => {
        queries.push(String(args[0]))
        return {}
      },
    })
    const server = await startServer(config(), { logger: logger(), ...f })
    try {
      expect((await fetch(`${server.url}/healthz`)).status).toBe(200)
      expect(queries).toContain('set local statement_timeout = 1500')
    } finally {
      await server.stop()
    }
  })
})

describe('startServer with the master key from the desktop host', () => {
  const desktop = (): Config => ({
    ...config(),
    mode: 'desktop',
    dataDir: dir,
    launchToken: LAUNCH_TOKEN,
  })
  const keyFile = () => join(dir, 'secrets', 'master.key')
  const hostKey = (raw: Buffer) => new HostMasterKey(new Uint8Array(raw), raw.toString('base64url'))
  const writeKeyFile = async (bytes: Buffer) => {
    await mkdir(join(dir, 'secrets'), { recursive: true })
    await writeFile(keyFile(), bytes)
  }
  const exists = (path: string) =>
    stat(path).then(
      () => true,
      () => false,
    )

  it('uses it instead of a key file, creates none, and zeroes the bytes it took', async () => {
    const raw = randomBytes(32)
    const taken = new Uint8Array(raw)
    const key = new HostMasterKey(taken, raw.toString('base64url'))
    const verifyMasterKey = vi.fn(async () => 'empty' as const)
    const server = await startServer(desktop(), {
      logger: logger(),
      ...fakes(),
      hostMasterKey: key,
      verifyMasterKey,
    })
    try {
      const other = await createSecretBox(new Uint8Array(raw))
      const blob = other.encrypt('stored-secret', 'provider_credentials:a')
      expect(server.secretBox.decrypt(blob, 'provider_credentials:a')).toBe('stored-secret')
      expect(await exists(keyFile())).toBe(false)
      expect(verifyMasterKey).toHaveBeenCalledTimes(1)
      expect(taken.every((b) => b === 0)).toBe(true)
    } finally {
      await server.stop()
    }
  })

  it('aborts boot when it does not decrypt the stored secrets, and closes the database', async () => {
    const f = fakes()
    const stored = (await createSecretBox(new Uint8Array(randomBytes(32)))).encrypt('s', 'row:1')
    const err = await startServer(desktop(), {
      logger: logger(),
      ...f,
      hostMasterKey: hostKey(randomBytes(32)),
      verifyMasterKey: async (box) => {
        box.decrypt(stored, 'row:1')
        return 'verified'
      },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MasterKeyError)
    const message = String((err as Error).message)
    expect(message).toMatch(/does not decrypt/)
    // The web search key is a stored secret too (D2.2), so the message names it.
    expect(message).toMatch(/web search key/)
    // Names the recovery that works, and is honest that deleting the entry does not.
    expect(message).toMatch(/Mawl\/master-key/)
    expect(message).toMatch(/from a backup/)
    expect(message).toMatch(/cannot be recovered/)
    expect(message).toMatch(/deleting the entry does not help/)
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('migration: an equal master.key is deleted only after the decrypt check passed', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    let fileDuringVerify: boolean | undefined
    const server = await startServer(desktop(), {
      logger: logger(),
      ...fakes(),
      hostMasterKey: hostKey(raw),
      verifyMasterKey: async () => {
        fileDuringVerify = await exists(keyFile())
        return 'verified'
      },
    })
    await server.stop()
    expect(fileDuringVerify).toBe(true)
    expect(await exists(keyFile())).toBe(false)
  })

  it('migration: an equal master.key is also retired when there is nothing to decrypt yet', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const server = await startServer(desktop(), {
      logger: logger(),
      ...fakes(),
      hostMasterKey: hostKey(raw),
      verifyMasterKey: async () => 'empty',
    })
    await server.stop()
    expect(await exists(keyFile())).toBe(false)
  })

  it('migration: a failed decrypt check keeps an equal master.key', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    await expect(
      startServer(desktop(), {
        logger: logger(),
        ...fakes(),
        hostMasterKey: hostKey(raw),
        verifyMasterKey: async () => {
          throw new SecretDecryptError()
        },
      }),
    ).rejects.toBeInstanceOf(MasterKeyError)
    expect((await readFile(keyFile())).equals(raw)).toBe(true)
  })

  it('migration: a master.key that differs aborts boot before the database, touching neither key', async () => {
    const fileKey = randomBytes(32)
    await writeKeyFile(fileKey)
    const f = fakes()
    const pg = vi.fn()
    const err = await startServer(desktop(), {
      logger: logger(),
      ...f,
      hostMasterKey: hostKey(randomBytes(32)),
      verifyMasterKey: async () => 'verified',
      startEmbeddedPostgres: pg,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(MasterKeyError)
    expect(String((err as Error).message)).toMatch(/differs/)
    expect(f.createDb).not.toHaveBeenCalled()
    expect(pg).not.toHaveBeenCalled()
    expect((await readFile(keyFile())).equals(fileKey)).toBe(true)
  })

  it('migration: a wrong-sized master.key aborts boot and is left alone', async () => {
    await writeKeyFile(Buffer.alloc(5, 1))
    await expect(
      startServer(desktop(), {
        logger: logger(),
        ...fakes(),
        hostMasterKey: hostKey(randomBytes(32)),
        verifyMasterKey: async () => 'verified',
      }),
    ).rejects.toThrow(/exactly 32 bytes/)
    expect((await readFile(keyFile())).length).toBe(5)
  })

  it('migration: overwrites master.key with zeros before deleting it', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    let atUnlink: Buffer | undefined
    const server = await startServer(desktop(), {
      logger: logger(),
      ...fakes(),
      hostMasterKey: hostKey(raw),
      verifyMasterKey: async () => 'verified',
      unlinkKeyFile: async (path) => {
        atUnlink = await readFile(path)
        await rm(path)
      },
    })
    await server.stop()
    expect(atUnlink?.length).toBe(32)
    expect(atUnlink?.every((b) => b === 0)).toBe(true)
    expect(await exists(keyFile())).toBe(false)
  })

  it('migration: still deletes master.key when overwriting it fails', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    await chmod(keyFile(), 0o444)
    let deleted = false
    const server = await startServer(desktop(), {
      logger: logger(),
      ...fakes(),
      hostMasterKey: hostKey(raw),
      verifyMasterKey: async () => 'verified',
      unlinkKeyFile: async (path) => {
        await chmod(path, 0o666)
        await rm(path)
        deleted = true
      },
    })
    await server.stop()
    expect(deleted).toBe(true)
    expect(await exists(keyFile())).toBe(false)
  })

  it('still boots when an equal master.key cannot be deleted, and says so', async () => {
    const raw = randomBytes(32)
    await writeKeyFile(raw)
    const lines: string[] = []
    const log = createLogger({
      level: 'info',
      stream: { write: (c: string) => void lines.push(c) },
    })
    const server = await startServer(desktop(), {
      logger: log,
      ...fakes(),
      hostMasterKey: hostKey(raw),
      verifyMasterKey: async () => 'verified',
      unlinkKeyFile: async () => {
        throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' })
      },
    })
    await server.stop()
    expect(lines.join('')).toContain('could not delete the old master key file')
    expect(lines.join('')).toContain('EBUSY')
    expect(lines.join('')).not.toContain(raw.toString('base64url'))
  })
})

describe('startServer with the embedded Postgres', () => {
  const EMBEDDED_URL = 'postgres://mawl:embedded-pw@127.0.0.1:50123/mawl'

  function embedded(opts: { fail?: Error } = {}) {
    const order: string[] = []
    const pgStop = vi.fn(async () => {
      order.push('pg.stop')
      return { clean: true }
    })
    const startEmbeddedPostgres = vi.fn(async (options: StartOptions) => {
      if (opts.fail) throw opts.fail
      // Like the real one: the stop for the spawned postgres goes out before it is ready.
      options.onSpawn?.(pgStop)
      order.push('pg.start')
      return {
        port: 50123,
        pid: 42,
        cold: false,
        connectionString: EMBEDDED_URL,
        connection: {} as PgConnection,
        exited: new Promise<never>(() => {}),
        output: () => '',
        stop: pgStop,
      } satisfies EmbeddedPostgres
    })
    return { startEmbeddedPostgres, pgStop, order }
  }

  const desktopConfig = (): Config => {
    const { databaseUrl: _url, ...rest } = config()
    return {
      ...rest,
      mode: 'desktop',
      dataDir: dir,
      launchToken: LAUNCH_TOKEN,
      embeddedPg: { pgRoot: join(dir, 'pg'), dataRoot: join(dir, 'pg-data') },
    }
  }

  it('starts it from the configured roots, opens the database on its url, and stops it last', async () => {
    const f = fakes()
    const pg = embedded()
    f.close.mockImplementation(async () => {
      pg.order.push('db.close')
    })
    const server = await startServer(desktopConfig(), { logger: logger(), ...f, ...pg })
    expect(pg.startEmbeddedPostgres).toHaveBeenCalledTimes(1)
    expect(pg.startEmbeddedPostgres.mock.calls[0]?.[0]).toMatchObject({
      pgRoot: join(dir, 'pg'),
      dataRoot: join(dir, 'pg-data'),
    })
    expect(f.createDb.mock.calls[0]?.[0]).toBe(EMBEDDED_URL)
    expect((await fetch(`${server.url}/healthz`)).status).toBe(200)
    await server.stop()
    await server.stop()
    expect(pg.order).toEqual(['pg.start', 'db.close', 'pg.stop'])
    expect(pg.pgStop).toHaveBeenCalledTimes(1)
  })

  it('does not fetch the Claude binary at boot, even with a pinned manifest in desktop mode', async () => {
    const ensureClaudeBinary = vi.fn(async () => join(dir, 'claude', '1.0.0', 'claude.exe'))
    const server = await startServer(desktopConfig(), {
      logger: logger(),
      ...fakes(),
      ...embedded(),
      claudeManifest: {
        version: '1.0.0',
        packages: {
          'win32-x64': { url: 'https://registry.example/x.tgz', integrity: 'sha512-AA' },
        },
      },
      ensureClaudeBinary,
    })
    try {
      expect((await fetch(`${server.url}/healthz`)).status).toBe(200)
      expect(ensureClaudeBinary).not.toHaveBeenCalled()
    } finally {
      await server.stop()
    }
  })

  it('registers an emergency stop for it, and none without it', async () => {
    const pg = embedded()
    const registerEmergencyStop = vi.fn()
    const server = await startServer(desktopConfig(), {
      logger: logger(),
      ...fakes(),
      ...pg,
      registerEmergencyStop,
    })
    expect(registerEmergencyStop).toHaveBeenCalledTimes(1)
    await registerEmergencyStop.mock.calls[0]?.[0]()
    expect(pg.pgStop).toHaveBeenCalledTimes(1)
    await server.stop()

    const headless = vi.fn()
    const other = await startServer(config(), {
      logger: logger(),
      ...fakes(),
      registerEmergencyStop: headless,
    })
    await other.stop()
    expect(headless).not.toHaveBeenCalled()
  })

  it('registers the emergency stop through onSpawn, before Postgres is ready', async () => {
    const registerEmergencyStop = vi.fn()
    const spawnStop = vi.fn(async () => ({ clean: true }))
    const pg = embedded()
    const seenBeforeReady: number[] = []
    pg.startEmbeddedPostgres.mockImplementationOnce(async (options: StartOptions) => {
      options.onSpawn?.(spawnStop)
      seenBeforeReady.push(registerEmergencyStop.mock.calls.length)
      throw new Error('postgres never became ready')
    })
    await expect(
      startServer(desktopConfig(), { logger: logger(), ...fakes(), ...pg, registerEmergencyStop }),
    ).rejects.toThrow(/never became ready/)
    expect(seenBeforeReady).toEqual([1])
    await registerEmergencyStop.mock.calls[0]?.[0]()
    expect(spawnStop).toHaveBeenCalledTimes(1)
  })

  it('passes the boot abort signal to the Postgres start', async () => {
    const pg = embedded()
    const controller = new AbortController()
    const server = await startServer(desktopConfig(), {
      logger: logger(),
      ...fakes(),
      ...pg,
      bootSignal: controller.signal,
    })
    expect(pg.startEmbeddedPostgres.mock.calls[0]?.[0].signal).toBe(controller.signal)
    await server.stop()
  })

  it('still stops it when an earlier shutdown step fails', async () => {
    const f = fakes()
    f.close.mockImplementation(async () => {
      throw new Error('pool end failed')
    })
    const pg = embedded()
    const server = await startServer(desktopConfig(), { logger: logger(), ...f, ...pg })
    await expect(server.stop()).rejects.toThrow(/pool end failed/)
    expect(pg.pgStop).toHaveBeenCalledTimes(1)
  })

  it('stops it when boot fails after it started, so no postgres is orphaned', async () => {
    const f = fakes({
      migrate: async () => {
        throw new Error('migration failed')
      },
    })
    const pg = embedded()
    await expect(startServer(desktopConfig(), { logger: logger(), ...f, ...pg })).rejects.toThrow(
      /migration failed/,
    )
    expect(f.close).toHaveBeenCalledTimes(1)
    expect(pg.pgStop).toHaveBeenCalledTimes(1)
  })

  it('does not start it when the secrets are unusable', async () => {
    const pg = embedded()
    await mkdir(join(dir, 'secrets'), { recursive: true })
    await writeFile(join(dir, 'secrets', HOST_ID_FILE), 'garbage')
    await expect(
      startServer(desktopConfig(), { logger: logger(), ...fakes(), ...pg }),
    ).rejects.toThrow(/host id/i)
    expect(pg.startEmbeddedPostgres).not.toHaveBeenCalled()
  })

  it('propagates its boot error without opening the database', async () => {
    const f = fakes()
    const pg = embedded({ fail: new Error('binaries missing') })
    await expect(startServer(desktopConfig(), { logger: logger(), ...f, ...pg })).rejects.toThrow(
      /binaries missing/,
    )
    expect(f.createDb).not.toHaveBeenCalled()
  })

  it('prefers a database url over the embedded Postgres', async () => {
    const f = fakes()
    const pg = embedded()
    const server = await startServer(
      { ...desktopConfig(), databaseUrl: 'postgres://mawl:own@db/mawl', embeddedPg: undefined },
      { logger: logger(), ...f, ...pg },
    )
    await server.stop()
    expect(pg.startEmbeddedPostgres).not.toHaveBeenCalled()
    expect(f.createDb.mock.calls[0]?.[0]).toBe('postgres://mawl:own@db/mawl')
  })

  it('refuses a config with neither a database url nor an embedded Postgres', async () => {
    const f = fakes()
    const { databaseUrl: _url, ...rest } = config()
    await expect(startServer(rest, { logger: logger(), ...f })).rejects.toThrow(
      /no database configured/,
    )
    expect(f.createDb).not.toHaveBeenCalled()
  })
})
