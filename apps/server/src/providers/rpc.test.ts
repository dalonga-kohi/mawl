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
import { createApp } from '../app.ts'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import { createProviderService } from './service.ts'

/** Not an `sk-` string: the logger's value scrubber would mask a leak. */
const SECRET = 'hunter2-over-the-wire-q7w3'

describe('providers over RPC (app + PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const lines: string[] = []
  const wire: string[] = []
  const providerRequests: Array<{ url: string; redirect: RequestInit['redirect'] }> = []
  let respond: () => Response = () => new Response('{}', { status: 200 })
  let rpc: ContractRouterClient<typeof contract>

  beforeAll(async () => {
    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    const logger = createLogger({
      level: 'trace',
      stream: { write: (chunk: string) => void lines.push(chunk) },
    })
    const providers = createProviderService({
      db,
      secretBox: await createSecretBox(new Uint8Array(randomBytes(32))),
      logger,
      fetch: (async (url: string | URL | Request, init?: RequestInit) => {
        providerRequests.push({ url: String(url), redirect: init?.redirect })
        return respond()
      }) as typeof globalThis.fetch,
    })
    const app = createApp({ logger, version: '1', providers, checkDb: async () => {} })
    rpc = createORPCClient(
      new RPCLink({
        url: 'http://faire.test/rpc',
        fetch: async (request) => {
          const res = await app.request(request)
          wire.push(await res.clone().text())
          return res
        },
      }),
    )
  })

  afterAll(() => client.close())

  it('creates, lists, tests and deletes a credential without the secret ever leaving', async () => {
    const created = await rpc.providers.create({
      provider: 'openai',
      label: 'Work',
      secret: SECRET,
    })
    expect(Object.keys(created).sort()).toEqual([
      'accountEmail',
      'baseUrl',
      'createdAt',
      'id',
      'label',
      'planUsage',
      'provider',
      'reauthRequired',
    ])
    expect(await rpc.providers.list()).toEqual([created])

    expect(await rpc.providers.test({ id: created.id })).toMatchObject({ ok: true })
    expect(
      await rpc.providers.test({ provider: 'anthropic', label: 'x', secret: SECRET }),
    ).toMatchObject({ ok: true })
    expect(providerRequests.every((r) => r.redirect === 'error')).toBe(true)

    respond = () => new Response(`{"error":"invalid key ${SECRET}"}`, { status: 401 })
    expect(await rpc.providers.test({ id: created.id })).toEqual({
      ok: false,
      reason: 'invalid_key',
    })

    expect(await rpc.providers.delete({ id: created.id })).toEqual({ ...created, revoked: true })
    expect(await rpc.providers.list()).toEqual([])

    expect(wire.length).toBeGreaterThan(0)
    expect(wire.join('\n')).not.toContain(SECRET)
    expect(lines.join('')).not.toContain(SECRET)
  })

  it('answers a typed NOT_FOUND for delete and test of an unknown id', async () => {
    const id = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as never
    await expect(rpc.providers.delete({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(rpc.providers.test({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects an unknown key and does not echo the secret in the validation error', async () => {
    wire.length = 0
    await expect(
      rpc.providers.create({
        provider: 'openai',
        label: 'x',
        secret: SECRET,
        // reason: deliberately violating the contract to prove the server rejects it.
        ...({ token: 'extra' } as object),
      }),
    ).rejects.toBeDefined()
    await expect(
      rpc.providers.create({ provider: 'openai', label: 'x'.repeat(81), secret: SECRET }),
    ).rejects.toBeDefined()
    expect(await rpc.providers.list()).toEqual([])
    expect(wire.join('\n')).not.toContain(SECRET)
    expect(lines.join('')).not.toContain(SECRET)
  })

  it('serves the provider catalog', async () => {
    const catalog = await rpc.providers.catalog()
    expect(catalog.map((d) => d.kind)).toEqual([
      'anthropic',
      'openai',
      'openrouter',
      'ollama',
      'openai_compatible',
      'openai_chatgpt',
      'anthropic_claude_code',
    ])
  })
})
