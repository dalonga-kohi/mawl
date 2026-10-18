import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import type { contract } from '@faire/contracts'
import { migrationsFolder, schema } from '@faire/db'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../app.ts'
import { createLogger } from '../../logger.ts'
import { unusedRuns } from '../../runs/test-util.ts'
import { createSecretBox } from '../../secrets/index.ts'
import { createProviderService } from '../service.ts'
import { fakeListeners, HOST_ID } from './test-util.ts'

describe('Sign in with ChatGPT over RPC (app + PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const listeners = fakeListeners()
  let withHost: ContractRouterClient<typeof contract>
  let withoutHost: ContractRouterClient<typeof contract>

  async function rpcFor(hostId: string | null) {
    const db = drizzle(client, { schema })
    const logger = createLogger({ level: 'silent' })
    const providers = createProviderService({
      db,
      secretBox: await createSecretBox(new Uint8Array(randomBytes(32))),
      logger,
      chatgpt: { hostId, port: 1455, bindHost: '127.0.0.1', startListener: listeners.start },
    })
    const app = createApp({
      logger,
      version: '1',
      providers,
      runs: unusedRuns,
      checkDb: async () => {},
    })
    return createORPCClient<ContractRouterClient<typeof contract>>(
      new RPCLink({ url: 'http://faire.test/rpc', fetch: async (request) => app.request(request) }),
    )
  }

  beforeAll(async () => {
    await migrate(drizzle(client, { schema }), { migrationsFolder })
    withHost = await rpcFor(HOST_ID)
    withoutHost = await rpcFor(null)
  })

  afterAll(() => client.close())

  it('starts an attempt and reports it pending', async () => {
    const started = await withHost.providers.chatgpt.start()
    expect(new URL(started.authorizeUrl).origin).toBe('https://auth.openai.com')
    expect(await withHost.providers.chatgpt.status({ attemptId: started.attemptId })).toEqual({
      status: 'pending',
    })
  })

  it('answers a typed NOT_FOUND for an unknown attempt', async () => {
    await expect(
      withHost.providers.chatgpt.status({ attemptId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('answers 503 SIGN_IN_UNAVAILABLE when no host id exists', async () => {
    await expect(withoutHost.providers.chatgpt.start()).rejects.toMatchObject({
      code: 'SIGN_IN_UNAVAILABLE',
      status: 503,
    })
  })

  it('rejects creating a ChatGPT credential from an api input', async () => {
    await expect(
      withHost.providers.create({ provider: 'openai_chatgpt', label: 'x', secret: 'y' }),
    ).rejects.toThrow()
    expect(await withHost.providers.list()).toEqual([])
  })
})
