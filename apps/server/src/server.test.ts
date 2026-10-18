import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateDbOptions, DbHandle } from '@faire/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { createLogger } from './logger.ts'
import { HOST_ID_FILE } from './secrets/index.ts'
import { startServer } from './server.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'faire-boot-'))
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
  return { close, migrate, createDb }
}

const config = (): Config => ({
  databaseUrl: 'postgres://faire:s3cr3t-pw@db/faire',
  host: '127.0.0.1',
  port: 0,
  secretsDir: join(dir, 'secrets'),
  siwcPort: 1455,
  siwcHost: '127.0.0.1',
  logLevel: 'silent',
})

const logger = () => createLogger({ level: 'silent' })

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
