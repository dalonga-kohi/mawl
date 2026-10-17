import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbHandle } from '@faire/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { createLogger } from './logger.ts'
import { startServer } from './server.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'faire-boot-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fakes(opts: { query?: () => Promise<unknown>; migrate?: () => Promise<void> } = {}) {
  const close = vi.fn(async () => {})
  const handle = {
    db: {},
    pool: { query: opts.query ?? (async () => ({ rows: [] })) },
    close,
  } as unknown as DbHandle
  const migrate = vi.fn(opts.migrate ?? (async () => {}))
  return { close, migrate, createDb: vi.fn(() => handle) }
}

const config = (): Config => ({
  databaseUrl: 'postgres://faire:s3cr3t-pw@db/faire',
  host: '127.0.0.1',
  port: 0,
  secretsDir: join(dir, 'secrets'),
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
})
