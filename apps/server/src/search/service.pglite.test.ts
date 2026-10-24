import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { migrationsFolder, schema } from '@mawl/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import { createSearchService } from './service.ts'

const { serviceCredentials } = schema
const KEY = 'BSA-secret-key-value'

describe('search key service (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const logLines: string[] = []
  const logger = createLogger({
    level: 'trace',
    stream: { write: (chunk: string) => void logLines.push(chunk) },
  })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  }, 120_000)
  afterAll(() => client.close())
  beforeEach(async () => {
    await db.delete(serviceCredentials)
    logLines.length = 0
  })

  async function service(fetch = vi.fn(async () => new Response('{}'))) {
    const secretBox = await createSecretBox(new Uint8Array(randomBytes(32)))
    return { svc: createSearchService({ db, secretBox, logger, fetch }), secretBox, fetch }
  }

  it('reports not configured until a key is set', async () => {
    const { svc } = await service()
    expect(await svc.status()).toEqual({ provider: 'brave', configured: false, updatedAt: null })
    expect(await svc.provider()).toBeNull()
  })

  it('stores the key encrypted and never returns it', async () => {
    const { svc, secretBox } = await service()
    const status = await svc.setKey({ provider: 'brave', apiKey: KEY })
    expect(status).toMatchObject({ provider: 'brave', configured: true })
    expect(status.updatedAt).toEqual(expect.any(String))
    expect(JSON.stringify(status)).not.toContain(KEY)
    expect(JSON.stringify(await svc.status())).not.toContain(KEY)

    const [row] = await db.select().from(serviceCredentials)
    expect(Buffer.from(row?.secretEnc ?? []).toString('utf8')).not.toContain(KEY)
    expect(
      secretBox.decrypt(row?.secretEnc ?? new Uint8Array(), 'service_credentials:brave_search'),
    ).toBe(KEY)
    expect(logLines.join('')).not.toContain(KEY)
  })

  it('replaces a key on a second set', async () => {
    const { svc, secretBox } = await service()
    await svc.setKey({ provider: 'brave', apiKey: 'first' })
    await svc.setKey({ provider: 'brave', apiKey: 'second' })
    const rows = await db.select().from(serviceCredentials)
    expect(rows).toHaveLength(1)
    expect(
      secretBox.decrypt(rows[0]?.secretEnc ?? new Uint8Array(), 'service_credentials:brave_search'),
    ).toBe('second')
  })

  it('clears the key', async () => {
    const { svc } = await service()
    await svc.setKey({ provider: 'brave', apiKey: KEY })
    expect(await svc.clearKey()).toEqual({ provider: 'brave', configured: false, updatedAt: null })
    expect(await svc.provider()).toBeNull()
    // Clearing twice is fine.
    expect((await svc.clearKey()).configured).toBe(false)
  })

  it('builds a Brave provider that sends the stored key in the header', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ web: { results: [] } })))
    const { svc } = await service(fetch)
    await svc.setKey({ provider: 'brave', apiKey: KEY })
    const provider = await svc.provider()
    expect(provider?.name).toBe('brave')
    await provider?.search('q', { count: 1, signal: new AbortController().signal })
    const init = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(new Headers(init.headers).get('x-subscription-token')).toBe(KEY)
  })

  it('treats a key that no longer decrypts as not configured and logs it without detail', async () => {
    const { svc } = await service()
    await svc.setKey({ provider: 'brave', apiKey: KEY })
    const other = createSearchService({
      db,
      secretBox: await createSecretBox(new Uint8Array(randomBytes(32))),
      logger,
    })
    expect(await other.provider()).toBeNull()
    expect(logLines.join('')).toContain('search key cannot be decrypted')
    // The row still exists, so the status says configured and the owner can replace it.
    expect((await other.status()).configured).toBe(true)
  })
})
