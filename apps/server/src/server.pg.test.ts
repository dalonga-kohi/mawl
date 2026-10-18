import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { contract } from '@faire/contracts'
import { withPostgres } from '@faire/testkit'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { describe, expect, it } from 'vitest'
import { createLogger } from './logger.ts'
import { startServer } from './server.ts'

describe('server against real Postgres', () => {
  const databaseUrl = withPostgres()

  it('migrates, answers /healthz 200, serves health.get over RPC and stops cleanly', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'faire-pg-boot-'))
    const server = await startServer(
      {
        databaseUrl: databaseUrl(),
        host: '127.0.0.1',
        port: 0,
        secretsDir: join(dir, 'secrets'),
        siwcPort: 1455,
        siwcHost: '127.0.0.1',
        logLevel: 'silent',
      },
      { logger: createLogger({ level: 'silent' }) },
    )
    try {
      const res = await fetch(`${server.url}/healthz`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      const client: ContractRouterClient<typeof contract> = createORPCClient(
        new RPCLink({ url: `${server.url}/rpc` }),
      )
      expect(await client.health.get()).toMatchObject({ ok: true, version: expect.any(String) })
    } finally {
      await server.stop()
      await rm(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
