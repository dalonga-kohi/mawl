import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { SearchStatus } from '@mawl/contracts'
import { BRAVE_SEARCH_URL, DDGS_SEARCH_URL, TAVILY_SEARCH_URL } from '@mawl/core'
import { migrationsFolder, schema } from '@mawl/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox, SecretDecryptError } from '../secrets/index.ts'
import { createSearchService } from './service.ts'

const { serviceCredentials } = schema

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const DDGS_PAGE = `<div class="result"><a class="result__a" href="https://ddg.example/">D</a></div>`
const routed = () =>
  vi.fn<Fetch>(async (url) => {
    const base = url.split('?')[0]
    if (base === TAVILY_SEARCH_URL) return Response.json({ results: [] })
    if (base === BRAVE_SEARCH_URL) return Response.json({ web: { results: [] } })
    if (base === DDGS_SEARCH_URL) return new Response(DDGS_PAGE)
    throw new Error(`unexpected url ${url}`)
  })
const run = (p: {
  search: (q: string, o: { count: number; signal: AbortSignal }) => Promise<{ backend: string }>
}) => p.search('q', { count: 3, signal: new AbortController().signal })

describe('search key service edge cases (PGlite)', () => {
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

  async function service(fetch: Fetch = routed()) {
    const secretBox = await createSecretBox(new Uint8Array(randomBytes(32)))
    return { svc: createSearchService({ db, secretBox, logger, fetch }), secretBox, fetch }
  }

  it('treats a corrupt or truncated blob as unreadable, not as a crash, and falls to DDGS', async () => {
    const fetch = routed()
    const { svc } = await service(fetch)
    await db.insert(serviceCredentials).values([
      { service: 'tavily_search', secretEnc: new Uint8Array([1, 2, 3]) },
      { service: 'brave_search', secretEnc: new Uint8Array(0) },
    ])
    const status = await svc.status()
    expect(status.backends.map((b) => [b.configured, b.unreadable])).toEqual([
      [true, true],
      [true, true],
    ])
    expect(SearchStatus.safeParse(status).success).toBe(true)
    expect((await run(await svc.provider())).backend).toBe('ddgs')
    expect(fetch.mock.calls.map(([u]) => u.split('?')[0])).toEqual([DDGS_SEARCH_URL])
    await expect(svc.verifyMasterKey()).rejects.toBeInstanceOf(SecretDecryptError)
  })

  it('clearing the only key returns the master-key check to empty', async () => {
    const { svc } = await service()
    await svc.setKey({ provider: 'brave', apiKey: 'k' })
    expect(await svc.verifyMasterKey()).toBe('verified')
    const status = await svc.clearKey({ provider: 'brave' })
    expect(status.backends.every((b) => !b.configured)).toBe(true)
    expect(await svc.verifyMasterKey()).toBe('empty')
  })

  it('clearing an unreadable key removes it, so the check passes again', async () => {
    const { svc } = await service()
    await db
      .insert(serviceCredentials)
      .values({ service: 'tavily_search', secretEnc: new Uint8Array([9, 9, 9]) })
    await expect(svc.verifyMasterKey()).rejects.toBeInstanceOf(SecretDecryptError)
    await svc.clearKey({ provider: 'tavily' })
    expect(await svc.verifyMasterKey()).toBe('empty')
  })

  it('setting a key over an unreadable one makes it readable and keeps one row', async () => {
    const { svc } = await service()
    await db
      .insert(serviceCredentials)
      .values({ service: 'brave_search', secretEnc: new Uint8Array([7]) })
    const status = await svc.setKey({ provider: 'brave', apiKey: 'fresh' })
    expect(status.backends[1]).toMatchObject({ configured: true, unreadable: false })
    expect(await db.select().from(serviceCredentials)).toHaveLength(1)
    expect(await svc.verifyMasterKey()).toBe('verified')
  })

  it('two concurrent sets for one backend leave one row and the last write opens', async () => {
    const { svc, secretBox } = await service()
    await Promise.all([
      svc.setKey({ provider: 'tavily', apiKey: 'aaaa' }),
      svc.setKey({ provider: 'tavily', apiKey: 'bbbb' }),
    ])
    const rows = await db.select().from(serviceCredentials)
    expect(rows).toHaveLength(1)
    expect(['aaaa', 'bbbb']).toContain(
      secretBox.decrypt(
        rows[0]?.secretEnc ?? new Uint8Array(),
        'service_credentials:tavily_search',
      ),
    )
  })

  it('a second set moves updatedAt forward and never backward', async () => {
    const { svc } = await service()
    const first = (await svc.setKey({ provider: 'tavily', apiKey: 'one' })).backends[0]?.updatedAt
    const second = (await svc.setKey({ provider: 'tavily', apiKey: 'two' })).backends[0]?.updatedAt
    expect(Date.parse(second ?? '')).toBeGreaterThanOrEqual(Date.parse(first ?? ''))
  })

  it('sends a 512-character punctuation-heavy key intact in the header', async () => {
    const key = `${'a!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'.repeat(15)}`.slice(0, 512)
    const fetch = routed()
    const { svc } = await service(fetch)
    await svc.setKey({ provider: 'tavily', apiKey: key })
    await run(await svc.provider())
    expect(new Headers(fetch.mock.calls[0]?.[1].headers).get('authorization')).toBe(`Bearer ${key}`)
  })

  it('does not log the key when saving, even at trace level', async () => {
    const { svc } = await service()
    await svc.setKey({ provider: 'brave', apiKey: 'SUPER-SECRET-VALUE' })
    await svc.provider()
    expect(logLines.join('')).not.toContain('SUPER-SECRET-VALUE')
  })

  it('a provider built before a key changed keeps its old chain; a new call sees the new key', async () => {
    const fetch = routed()
    const { svc } = await service(fetch)
    const before = await svc.provider()
    await svc.setKey({ provider: 'tavily', apiKey: 'late' })
    expect((await run(before)).backend).toBe('ddgs')
    expect((await run(await svc.provider())).backend).toBe('tavily')
  })

  it('builds a fresh DDGS cool-down per service, not per search chain', async () => {
    const challenge =
      '<form id="challenge-form"><p>confirm this search was made by a human</p><button type="submit">Go</button></form>'
    const fetch = vi.fn<Fetch>(async () => new Response(challenge))
    const { svc } = await service(fetch)
    // A chain built after the block still honours it.
    await run(await svc.provider()).catch(() => {})
    await svc.setKey({ provider: 'brave', apiKey: 'k' }) // brave fetch hits the same stub: challenge body is not JSON
    await run(await svc.provider()).catch(() => {})
    const ddgsCalls = fetch.mock.calls.filter(([u]) => u.startsWith(DDGS_SEARCH_URL))
    expect(ddgsCalls).toHaveLength(1)
  })
})
