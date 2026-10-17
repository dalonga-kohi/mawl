import { randomBytes } from 'node:crypto'
import { ProviderCredential, type ProviderCredentialInput } from '@faire/contracts'
import { schema } from '@faire/db'
import { count, eq } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import {
  CredentialNotFoundError,
  CredentialUnreadableError,
  createProviderService,
} from './service.ts'

export type SuiteDb = PgDatabase<PgQueryResultHKT, typeof schema>

export interface MadeServiceDb {
  db: SuiteDb
  migrate(): Promise<void>
  close(): Promise<void>
}

/** Not an `sk-` string: the logger's value scrubber would hide a leak from these tests. */
const SECRET = 'hunter2-plain-secret-zq81'

const input = (over: Partial<ProviderCredentialInput> = {}): ProviderCredentialInput =>
  ({ provider: 'openai', label: 'Work', secret: SECRET, ...over }) as ProviderCredentialInput

/** The same suite runs on PGlite (in process) and on real Postgres. */
export function describeProviderService(name: string, make: () => Promise<MadeServiceDb>): void {
  describe(name, () => {
    let made: MadeServiceDb
    let logLines: string[]
    let requests: Array<{ url: string; headers: Headers }>
    let respond: () => Response

    const { providerCredentials: table } = schema

    async function setup() {
      const box = await createSecretBox(new Uint8Array(randomBytes(32)))
      const logger = createLogger({
        level: 'trace',
        stream: { write: (chunk: string) => void logLines.push(chunk) },
      })
      const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), headers: new Headers(init?.headers) })
        return respond()
      }) as typeof globalThis.fetch
      const service = createProviderService({ db: made.db, secretBox: box, logger, fetch })
      return { service, box }
    }

    beforeEach(async () => {
      logLines = []
      requests = []
      respond = () => new Response('{}', { status: 200 })
      made = await make()
      await made.migrate()
    }, 60_000)

    afterEach(async () => {
      await made.close()
    })

    it('create returns the public shape, never the secret', async () => {
      const { service } = await setup()
      const created = await service.create(input({ label: 'Work key' }))
      expect(ProviderCredential.safeParse(created).success).toBe(true)
      expect(created).toMatchObject({ provider: 'openai', label: 'Work key', baseUrl: null })
      expect(created.id).toMatch(/^cred_/)
      expect(JSON.stringify(created)).not.toContain(SECRET)
    })

    it('stores only ciphertext: the plaintext is nowhere in the row', async () => {
      const { service } = await setup()
      const created = await service.create(input())
      const [row] = await made.db.select().from(table).where(eq(table.id, created.id))
      expect(row).toBeDefined()
      const bytes = Buffer.from(row?.secretEnc ?? [])
      expect(bytes.length).toBeGreaterThan(SECRET.length)
      expect(bytes.includes(Buffer.from(SECRET))).toBe(false)
      expect(JSON.stringify(row)).not.toContain(SECRET)
    })

    it('stores a key-less credential (ollama) with an empty encrypted secret', async () => {
      const { service } = await setup()
      const { secret: _omit, ...rest } = input({ provider: 'ollama', baseUrl: 'http://h:11434' })
      const created = await service.create(rest)
      expect(created.baseUrl).toBe('http://h:11434')
      await expect(service.resolveCredential(created.id)).resolves.toEqual({
        kind: 'ollama',
        baseUrl: 'http://h:11434',
        secret: null,
      })
    })

    it('list returns public rows oldest first and no secret', async () => {
      const { service } = await setup()
      const a = await service.create(input({ label: 'a' }))
      const b = await service.create(input({ provider: 'anthropic', label: 'b' }))
      const listed = await service.list()
      expect(listed.map((c) => c.id)).toEqual([a.id, b.id])
      for (const row of listed) {
        expect(Object.keys(row).sort()).toEqual(['baseUrl', 'createdAt', 'id', 'label', 'provider'])
      }
      expect(JSON.stringify(listed)).not.toContain(SECRET)
    })

    it('delete removes the row and returns the public shape', async () => {
      const { service } = await setup()
      const created = await service.create(input())
      const deleted = await service.delete(created.id)
      expect(deleted).toEqual(created)
      expect(JSON.stringify(deleted)).not.toContain(SECRET)
      expect(await service.list()).toEqual([])
      const [n] = await made.db.select({ n: count() }).from(table)
      expect(n?.n).toBe(0)
    })

    it('delete of a missing id throws CredentialNotFoundError', async () => {
      const { service } = await setup()
      const missing = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as never
      await expect(service.delete(missing)).rejects.toBeInstanceOf(CredentialNotFoundError)
    })

    it('resolveCredential decrypts for the run engine', async () => {
      const { service } = await setup()
      const created = await service.create(input({ baseUrl: 'https://proxy.example.com/v1' }))
      await expect(service.resolveCredential(created.id)).resolves.toEqual({
        kind: 'openai',
        baseUrl: 'https://proxy.example.com/v1',
        secret: SECRET,
      })
      const missing = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as never
      await expect(service.resolveCredential(missing)).rejects.toBeInstanceOf(
        CredentialNotFoundError,
      )
    })

    it('a ciphertext moved to another row does not decrypt (AAD binds it to its row)', async () => {
      const { service } = await setup()
      const a = await service.create(input({ label: 'a', secret: 'secret-of-a-111' }))
      const b = await service.create(input({ label: 'b', secret: 'secret-of-b-222' }))
      const [rowA] = await made.db.select().from(table).where(eq(table.id, a.id))
      await made.db
        .update(table)
        .set({ secretEnc: rowA?.secretEnc as Uint8Array })
        .where(eq(table.id, b.id))
      await expect(service.resolveCredential(a.id)).resolves.toMatchObject({
        secret: 'secret-of-a-111',
      })
      await expect(service.resolveCredential(b.id)).rejects.toBeInstanceOf(
        CredentialUnreadableError,
      )
    })

    it('test by id sends the stored key to the provider and reports ok', async () => {
      const { service } = await setup()
      const created = await service.create(input())
      const result = await service.test({ id: created.id })
      expect(result).toMatchObject({ ok: true })
      expect(requests).toHaveLength(1)
      expect(requests[0]?.url).toBe('https://api.openai.com/v1/models')
      expect(requests[0]?.headers.get('authorization')).toBe(`Bearer ${SECRET}`)
    })

    it('test by id maps a rejected key to invalid_key', async () => {
      const { service } = await setup()
      const created = await service.create(input())
      respond = () => new Response(`{"error":"bad key ${SECRET}"}`, { status: 401 })
      const result = await service.test({ id: created.id })
      expect(result).toEqual({ ok: false, reason: 'invalid_key' })
      expect(JSON.stringify(result)).not.toContain(SECRET)
    })

    it('test by id of a missing credential throws CredentialNotFoundError', async () => {
      const { service } = await setup()
      const missing = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as never
      await expect(service.test({ id: missing })).rejects.toBeInstanceOf(CredentialNotFoundError)
      expect(requests).toHaveLength(0)
    })

    it('test by input calls the provider and writes nothing', async () => {
      const { service } = await setup()
      const result = await service.test(input({ provider: 'anthropic' }))
      expect(result).toMatchObject({ ok: true })
      expect(requests[0]?.url).toBe('https://api.anthropic.com/v1/models')
      expect(requests[0]?.headers.get('x-api-key')).toBe(SECRET)
      const [n] = await made.db.select({ n: count() }).from(table)
      expect(n?.n).toBe(0)
    })

    it('test by id with an undecryptable row throws CredentialUnreadableError and logs the error name only', async () => {
      const { service } = await setup()
      const a = await service.create(input({ label: 'a', secret: 'secret-of-a-111' }))
      const b = await service.create(input({ label: 'b', secret: 'secret-of-b-222' }))
      const [rowA] = await made.db.select().from(table).where(eq(table.id, a.id))
      await made.db
        .update(table)
        .set({ secretEnc: rowA?.secretEnc as Uint8Array })
        .where(eq(table.id, b.id))
      const err = await service.test({ id: b.id }).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CredentialUnreadableError)
      expect((err as CredentialUnreadableError).id).toBe(b.id)
      expect(String((err as Error).message)).not.toContain('secret-of-')
      expect(requests).toHaveLength(0)
      const logged = logLines.join('')
      expect(logged).toContain('SecretDecryptError')
      expect(logged).not.toContain('secret-of-')
    })

    it('never logs the secret during create, test, list or delete', async () => {
      const { service } = await setup()
      const created = await service.create(input())
      await service.test({ id: created.id })
      await service.test(input())
      respond = () => new Response(`${SECRET}`, { status: 500 })
      await service.test({ id: created.id })
      await service.list()
      await service.delete(created.id)
      expect(logLines.length).toBeGreaterThan(0)
      expect(logLines.join('')).not.toContain(SECRET)
    })
  })
}
