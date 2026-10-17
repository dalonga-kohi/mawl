import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { migrationsFolder, schema } from '@faire/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import { CredentialNotFoundError, createProviderService, type ProviderService } from './service.ts'

describe('provider service edge cases (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  let service: ProviderService
  const requests: string[] = []

  beforeAll(async () => {
    const db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    service = createProviderService({
      db,
      secretBox: await createSecretBox(new Uint8Array(randomBytes(32))),
      logger: createLogger({ level: 'trace', stream: { write: () => {} } }),
      fetch: (async (url: string | URL | Request) => {
        requests.push(String(url))
        return new Response('{}', { status: 200 })
      }) as typeof globalThis.fetch,
    })
  }, 60_000)

  afterAll(() => client.close())

  it('delete twice: second call throws CredentialNotFoundError', async () => {
    const c = await service.create({ provider: 'openai', label: 'tmp', secret: 'edge-secret-1' })
    await service.delete(c.id)
    await expect(service.delete(c.id)).rejects.toBeInstanceOf(CredentialNotFoundError)
  })

  it('test and resolve by a deleted id throw CredentialNotFoundError and call no provider', async () => {
    const c = await service.create({ provider: 'openai', label: 'tmp', secret: 'edge-secret-2' })
    await service.delete(c.id)
    const before = requests.length
    await expect(service.test({ id: c.id })).rejects.toBeInstanceOf(CredentialNotFoundError)
    await expect(service.resolveCredential(c.id)).rejects.toBeInstanceOf(CredentialNotFoundError)
    expect(requests.length).toBe(before)
  })

  it('concurrent creates get distinct ids and each decrypts to its own secret', async () => {
    const made = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        service.create({ provider: 'openai', label: `c${i}`, secret: `edge-concurrent-${i}` }),
      ),
    )
    expect(new Set(made.map((m) => m.id)).size).toBe(12)
    for (const [i, m] of made.entries()) {
      await expect(service.resolveCredential(m.id)).resolves.toMatchObject({
        secret: `edge-concurrent-${i}`,
      })
    }
  })

  it('round-trips a 4096-char unicode-bearing secret and a unicode label', async () => {
    const secret = `ключ-🔑-${'é'.repeat(4000)}`.slice(0, 4096)
    const c = await service.create({ provider: 'openai', label: '日本語 🔑 ラベル', secret })
    expect(c.label).toBe('日本語 🔑 ラベル')
    expect((await service.list()).find((x) => x.id === c.id)?.label).toBe('日本語 🔑 ラベル')
    await expect(service.resolveCredential(c.id)).resolves.toMatchObject({ secret })
  })

  it('stores an openai_compatible credential without a secret as null secret', async () => {
    const c = await service.create({
      provider: 'openai_compatible',
      label: 'local',
      baseUrl: 'http://127.0.0.1:8080/v1/',
    })
    await expect(service.resolveCredential(c.id)).resolves.toEqual({
      kind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:8080/v1/',
      secret: null,
    })
    await service.test({ id: c.id })
    expect(requests.at(-1)).toBe('http://127.0.0.1:8080/v1/models')
  })
})
