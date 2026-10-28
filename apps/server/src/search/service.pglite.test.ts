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
const BRAVE_KEY = 'BSA-secret-key-value'
const TAVILY_KEY = 'tvly-secret-key-value'

type Fetch = (url: string, init: RequestInit) => Promise<Response>

const DDGS_PAGE = `<div id="links"><div class="result web-result"><h2 class="result__title"><a class="result__a" href="https://ddg.example/">From DDG</a></h2></div></div>`

/** A fetch that answers each backend by url: `fail` maps a backend url to an HTTP status. */
function routed(fail: Partial<Record<string, number>> = {}) {
  return vi.fn<Fetch>(async (url) => {
    const base = url.split('?')[0] ?? url
    const status = fail[base]
    if (status) return new Response('{}', { status })
    if (base === TAVILY_SEARCH_URL) {
      return Response.json({ results: [{ title: 'T', url: 'https://t.example/', content: '' }] })
    }
    if (base === BRAVE_SEARCH_URL) {
      return Response.json({ web: { results: [{ title: 'B', url: 'https://b.example/' }] } })
    }
    if (base === DDGS_SEARCH_URL) return new Response(DDGS_PAGE)
    throw new Error(`unexpected url ${url}`)
  })
}

const calledUrls = (fetch: ReturnType<typeof routed>) =>
  fetch.mock.calls.map(([url]) => url.split('?')[0])

const search = (p: { search: (q: string, o: { count: number; signal: AbortSignal }) => unknown }) =>
  p.search('q', { count: 3, signal: new AbortController().signal }) as Promise<{
    backend: string
  }>

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

  async function service(fetch: Fetch = routed()) {
    const secretBox = await createSecretBox(new Uint8Array(randomBytes(32)))
    return { svc: createSearchService({ db, secretBox, logger, fetch }), secretBox, fetch }
  }
  async function otherBox(fetch: Fetch = routed()) {
    return createSearchService({
      db,
      secretBox: await createSecretBox(new Uint8Array(randomBytes(32))),
      logger,
      fetch,
    })
  }

  const none = (provider: 'tavily' | 'brave') => ({
    provider,
    configured: false,
    unreadable: false,
    updatedAt: null,
  })

  it('reports both keyed backends unconfigured and DDGS as the fallback until a key is set', async () => {
    const { svc } = await service()
    const status = await svc.status()
    expect(status).toEqual({ backends: [none('tavily'), none('brave')], fallback: 'ddgs' })
    expect(SearchStatus.safeParse(status).success).toBe(true)
  })

  it('stores each key encrypted in its own row, bound to that row, and never returns it', async () => {
    const { svc, secretBox } = await service()
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    const status = await svc.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    expect(status.backends.map((b) => [b.provider, b.configured])).toEqual([
      ['tavily', true],
      ['brave', true],
    ])
    expect(status.backends.every((b) => typeof b.updatedAt === 'string')).toBe(true)
    for (const s of [status, await svc.status()]) {
      expect(JSON.stringify(s)).not.toContain(TAVILY_KEY)
      expect(JSON.stringify(s)).not.toContain(BRAVE_KEY)
      expect(SearchStatus.safeParse(s).success).toBe(true)
    }

    const rows = await db.select().from(serviceCredentials)
    const row = (service: string) => rows.find((r) => r.service === service)?.secretEnc
    const tavily = row('tavily_search') ?? new Uint8Array()
    const brave = row('brave_search') ?? new Uint8Array()
    expect(Buffer.from(tavily).toString('utf8')).not.toContain(TAVILY_KEY)
    expect(Buffer.from(brave).toString('utf8')).not.toContain(BRAVE_KEY)
    expect(secretBox.decrypt(tavily, 'service_credentials:tavily_search')).toBe(TAVILY_KEY)
    expect(secretBox.decrypt(brave, 'service_credentials:brave_search')).toBe(BRAVE_KEY)
    // A blob moved to the other row does not open there.
    expect(() => secretBox.decrypt(tavily, 'service_credentials:brave_search')).toThrow(
      SecretDecryptError,
    )
    expect(logLines.join('')).not.toContain(TAVILY_KEY)
    expect(logLines.join('')).not.toContain(BRAVE_KEY)
  })

  it('replaces a key on a second set', async () => {
    const { svc, secretBox } = await service()
    await svc.setKey({ provider: 'tavily', apiKey: 'first' })
    await svc.setKey({ provider: 'tavily', apiKey: 'second' })
    const rows = await db.select().from(serviceCredentials)
    expect(rows).toHaveLength(1)
    expect(
      secretBox.decrypt(
        rows[0]?.secretEnc ?? new Uint8Array(),
        'service_credentials:tavily_search',
      ),
    ).toBe('second')
  })

  it('clears one backend and leaves the other; clearing twice is fine', async () => {
    const { svc } = await service()
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    await svc.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    const after = await svc.clearKey({ provider: 'tavily' })
    expect(after.backends[0]).toEqual(none('tavily'))
    expect(after.backends[1]).toMatchObject({ provider: 'brave', configured: true })
    expect((await svc.clearKey({ provider: 'tavily' })).backends[0]?.configured).toBe(false)
    expect(await db.select().from(serviceCredentials)).toHaveLength(1)
  })

  it('searches with DDGS alone when no key is set', async () => {
    const fetch = routed()
    const { svc } = await service(fetch)
    expect((await search(await svc.provider())).backend).toBe('ddgs')
    expect(calledUrls(fetch)).toEqual([DDGS_SEARCH_URL])
  })

  it('tries Tavily, then Brave, then DDGS, each with its own stored key in the header', async () => {
    const fetch = routed({ [TAVILY_SEARCH_URL]: 401, [BRAVE_SEARCH_URL]: 429 })
    const { svc } = await service(fetch)
    await svc.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    expect((await search(await svc.provider())).backend).toBe('ddgs')
    expect(calledUrls(fetch)).toEqual([TAVILY_SEARCH_URL, BRAVE_SEARCH_URL, DDGS_SEARCH_URL])
    const headers = fetch.mock.calls.map(([, init]) => new Headers(init.headers))
    expect(headers[0]?.get('authorization')).toBe(`Bearer ${TAVILY_KEY}`)
    expect(headers[1]?.get('x-subscription-token')).toBe(BRAVE_KEY)
    expect(headers[2]?.get('authorization')).toBeNull()
    expect(headers[2]?.get('x-subscription-token')).toBeNull()
  })

  it('answers from the first keyed backend that works', async () => {
    const fetch = routed()
    const { svc } = await service(fetch)
    await svc.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    expect((await search(await svc.provider())).backend).toBe('brave')
    expect(calledUrls(fetch)).toEqual([BRAVE_SEARCH_URL])
  })

  it('reads the keys per call, so a cleared key stops being used at once', async () => {
    const fetch = routed()
    const { svc } = await service(fetch)
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    expect((await search(await svc.provider())).backend).toBe('tavily')
    await svc.clearKey({ provider: 'tavily' })
    expect((await search(await svc.provider())).backend).toBe('ddgs')
  })

  it('skips a key that no longer decrypts, logs it without detail, and shows it unreadable', async () => {
    const fetch = routed()
    const { svc } = await service()
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    const other = await otherBox(fetch)
    await other.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    logLines.length = 0

    expect((await search(await other.provider())).backend).toBe('brave')
    expect(calledUrls(fetch)).toEqual([BRAVE_SEARCH_URL])
    const log = logLines.join('')
    expect(log).toContain('search key cannot be decrypted')
    expect(log).toContain('tavily_search')
    expect(log).not.toContain(TAVILY_KEY)

    const status = await other.status()
    expect(status.backends[0]).toMatchObject({
      provider: 'tavily',
      configured: true,
      unreadable: true,
    })
    expect(status.backends[1]).toMatchObject({ provider: 'brave', unreadable: false })
    expect((await svc.status()).backends[0]).toMatchObject({ unreadable: false })
  })

  it('verifyMasterKey: empty without keys, verified when every key opens', async () => {
    const { svc } = await service()
    expect(await svc.verifyMasterKey()).toBe('empty')
    await svc.setKey({ provider: 'tavily', apiKey: TAVILY_KEY })
    await svc.setKey({ provider: 'brave', apiKey: BRAVE_KEY })
    expect(await svc.verifyMasterKey()).toBe('verified')
  })

  it.each([
    ['tavily', 'brave'],
    ['brave', 'tavily'],
  ] as const)(
    'verifyMasterKey fails when one of several keys (%s) does not open',
    async (bad, good) => {
      const { svc } = await service()
      await svc.setKey({ provider: bad, apiKey: 'from-another-key' })
      const other = await otherBox()
      await other.setKey({ provider: good, apiKey: 'readable' })
      await expect(other.verifyMasterKey()).rejects.toBeInstanceOf(SecretDecryptError)
    },
  )

  it('keeps one DDGS instance, so its cool-down after a block outlives a single search', async () => {
    const challenge =
      '<form id="challenge-form"><p>Unfortunately, bots use DuckDuckGo too.</p><button type="submit">Go</button></form>'
    const fetch = vi.fn<Fetch>(async () => new Response(challenge))
    const { svc } = await service(fetch)
    await expect(search(await svc.provider())).rejects.toThrow()
    await expect(search(await svc.provider())).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
