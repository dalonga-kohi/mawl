import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbHandle } from '@mawl/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { createLogger } from './logger.ts'
import type { ProviderService } from './providers/service.ts'
import { startServer } from './server.ts'

// Wraps the real service so the test can see which instance boot made and when it was aborted.
const made: ProviderService[] = []
vi.mock('./providers/service.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('./providers/service.ts')>()
  return {
    ...original,
    createProviderService: (...args: Parameters<typeof original.createProviderService>) => {
      const service = original.createProviderService(...args)
      made.push(service)
      return service
    },
  }
})

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-abort-'))
  made.length = 0
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const config = (): Config => ({
  databaseUrl: 'postgres://mawl:pw@db/mawl',
  host: '127.0.0.1',
  port: 0,
  secretsDir: join(dir, 'secrets'),
  siwcPort: 1455,
  siwcHost: '127.0.0.1',
  logLevel: 'silent',
})

describe('server shutdown and the Claude binary download', () => {
  it('stop() aborts the Claude binary downloads in flight', async () => {
    const handle = {
      db: {},
      pool: { connect: async () => ({ query: async () => ({ rows: [] }), release() {} }) },
      close: async () => {},
    } as unknown as DbHandle
    const server = await startServer(config(), {
      logger: createLogger({ level: 'silent' }),
      createDb: () => handle,
      migrate: async () => {},
      worker: false,
      events: false,
    })
    const service = made[0]
    expect(service).toBeDefined()
    const abortPending = vi.spyOn(service as ProviderService, 'abortPending')
    expect(abortPending).not.toHaveBeenCalled()
    await server.stop()
    expect(abortPending).toHaveBeenCalledTimes(1)
  })
})
