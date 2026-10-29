import { newId } from '@mawl/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { allowAllGate } from '../gate.ts'
import { createToolRegistry } from '../registry.ts'
import { MemoryLedger } from '../test-util.ts'
import {
  BRAVE_SEARCH_URL,
  braveSearch,
  chainedSearch,
  SEARCH_BACKEND_TIMEOUT_MS,
  SEARCH_BACKENDS_MAX,
  SearchFailedError,
  type SearchProvider,
  tavilySearch,
  WEB_SEARCH_TIMEOUT_MS,
  webSearchTool,
} from './web-search.ts'

const r1 = { title: 'One', url: 'https://one.example/', snippet: '' }

const runId = newId('run')
const profileId = newId('profile')
const KEY = 'BSA-test-key-123'

type FetchFn = (url: string, init: RequestInit) => Promise<Response>

function bind(provider: SearchProvider, timeoutMs?: number) {
  const ledger = new MemoryLedger()
  const run = createToolRegistry({
    gate: allowAllGate,
    tools: [webSearchTool({ provider: async () => provider, ...(timeoutMs ? { timeoutMs } : {}) })],
  }).forRun({ runId, profileId })
  let n = 0
  const call = (input: unknown) =>
    run.invoke(
      { stepIdx: 0, toolCallId: `c${++n}`, toolName: 'web_search', input },
      { ledger, signal: new AbortController().signal, allowPark: true },
    )
  return { ledger, call }
}

const text = (r: Awaited<ReturnType<ReturnType<typeof bind>['call']>>) => {
  if (r.kind !== 'result') throw new Error('expected a result')
  const o = r.part.output
  return o.type === 'text' || o.type === 'error-text' ? o.value : ''
}

const braveBody = {
  type: 'search',
  web: {
    results: [
      {
        title: 'Python <strong>Web</strong> Frameworks',
        url: 'https://example.com/python',
        description: 'Main snippet &amp; <strong>more</strong>',
        extra: 'ignored',
      },
      { title: 'Second', url: 'https://example.org/2', description: 'Two' },
    ],
  },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.useRealTimers()
})

describe('braveSearch', () => {
  it('calls the web search endpoint with the subscription token header and the query', async () => {
    const fetch = vi.fn<FetchFn>(async () => json(braveBody))
    const results = await braveSearch({ apiKey: KEY, fetch }).search('python web', {
      count: 2,
      signal: new AbortController().signal,
    })
    const [url, init] = fetch.mock.calls[0] ?? []
    const parsed = new URL(url ?? '')
    expect(`${parsed.origin}${parsed.pathname}`).toBe(BRAVE_SEARCH_URL)
    expect(parsed.searchParams.get('q')).toBe('python web')
    expect(parsed.searchParams.get('count')).toBe('2')
    expect(new Headers(init?.headers).get('x-subscription-token')).toBe(KEY)
    expect(new Headers(init?.headers).get('accept')).toBe('application/json')
    expect(init?.redirect).toBe('error')
    // The key travels in the header only, never in the url.
    expect(url).not.toContain(KEY)
    expect(results).toEqual({
      backend: 'brave',
      results: [
        {
          title: 'Python Web Frameworks',
          url: 'https://example.com/python',
          snippet: 'Main snippet & more',
        },
        { title: 'Second', url: 'https://example.org/2', snippet: 'Two' },
      ],
    })
  })

  it('answers no web results as an empty list', async () => {
    const fetch = vi.fn<FetchFn>(async () => json({ type: 'search' }))
    expect(
      await braveSearch({ apiKey: KEY, fetch }).search('x', {
        count: 5,
        signal: new AbortController().signal,
      }),
    ).toEqual({ backend: 'brave', results: [] })
  })

  it('maps a network error to unavailable', async () => {
    const fetch = vi.fn<FetchFn>(async () => {
      throw new TypeError('fetch failed')
    })
    const err = await braveSearch({ apiKey: KEY, fetch })
      .search('x', { count: 5, signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect((err as SearchFailedError).reason).toBe('unavailable')
  })

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const fetch = vi.fn<FetchFn>(async () => json({ error: KEY }, status))
    const err = await braveSearch({ apiKey: KEY, fetch })
      .search('x', { count: 5, signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SearchFailedError)
    expect((err as SearchFailedError).reason).toBe(reason)
  })

  it('treats a response that is not the documented shape as unavailable', async () => {
    const fetch = vi.fn<FetchFn>(async () => json({ web: { results: 'nope' } }))
    const err = await braveSearch({ apiKey: KEY, fetch })
      .search('x', { count: 5, signal: new AbortController().signal })
      .catch((e: unknown) => e)
    expect((err as SearchFailedError).reason).toBe('unavailable')
  })
})

describe('web_search timeouts', () => {
  it('leaves every backend of the full chain its own timeout inside the tool total', () => {
    expect(SEARCH_BACKENDS_MAX).toBe(3) // tavily, brave, ddgs
    expect(SEARCH_BACKENDS_MAX * SEARCH_BACKEND_TIMEOUT_MS).toBeLessThan(WEB_SEARCH_TIMEOUT_MS)
  })
})

describe('web_search tool', () => {
  const brave = (fetch: FetchFn) => braveSearch({ apiKey: KEY, fetch })

  it('lists the results as data', async () => {
    const out = text(await bind(brave(async () => json(braveBody))).call({ query: 'python web' }))
    expect(out.startsWith('<tool_result>\n')).toBe(true)
    expect(out).toContain('Source: brave\n1. Python Web Frameworks')
    expect(out).toContain('https://example.com/python')
    expect(out).toContain('2. Second')
  })

  it('says so when nothing was found, and which backend said it', async () => {
    const out = text(await bind(brave(async () => json({}))).call({ query: 'zzz' }))
    expect(out).toContain('Source: brave\nNo results')
  })

  it('reports a rejected key as search_unavailable and never shows the key', async () => {
    const r = await bind(brave(async () => json({ msg: KEY }, 401))).call({ query: 'x' })
    expect(r.kind === 'result' && r.record.isError).toBe(true)
    const out = text(r)
    expect(out).toContain('search_unavailable')
    expect(out).toContain('brave (invalid_key)')
    expect(out).toContain('check it in Settings')
    expect(out).not.toContain(KEY)
  })

  it('reports a network failure without its text', async () => {
    const out = text(
      await bind(
        brave(async () => {
          throw new TypeError(`connect ECONNREFUSED ${KEY}`)
        }),
      ).call({ query: 'x' }),
    )
    expect(out).toContain('search_unavailable')
    expect(out).not.toContain('ECONNREFUSED')
  })

  it('names the backend that answered a chain', async () => {
    const chain = chainedSearch([
      brave(async () => json({}, 429)),
      { name: 'ddgs', search: async () => ({ backend: 'ddgs', results: [r1] }) },
    ])
    const out = text(await bind(chain).call({ query: 'q' }))
    expect(out).toContain('Source: ddgs\n1. One')
  })

  it('lists every backend and its reason when none answers, with no response text', async () => {
    const chain = chainedSearch([
      tavilySearch({ apiKey: 'tvly-k', fetch: async () => json({ e: 'tvly-k' }, 401) }),
      brave(async () => json({ e: KEY }, 429)),
      { name: 'ddgs', search: () => Promise.reject(new SearchFailedError('unavailable')) },
    ])
    const out = text(await bind(chain).call({ query: 'q' }))
    expect(out).toContain('search_unavailable')
    expect(out).toContain('tavily (invalid_key), brave (rate_limited), ddgs (unavailable)')
    expect(out).not.toContain(KEY)
    expect(out).not.toContain('tvly-k')
  })

  it('tells the owner DuckDuckGo asked for a human check and that a free key fixes it', async () => {
    const chain = chainedSearch([
      { name: 'ddgs', search: () => Promise.reject(new SearchFailedError('unavailable')) },
    ])
    const out = text(await bind(chain).call({ query: 'q' }))
    expect(out).toContain('ddgs (unavailable)')
    expect(out).toContain('human check')
    expect(out).toContain('free Tavily or Brave Search key')
  })

  it('an unexpected error is a generic failure without its text', async () => {
    const out = text(
      await bind({
        name: 'x',
        search: () => Promise.reject(new RangeError(`bug ${KEY}`)),
      }).call({ query: 'q' }),
    )
    expect(out).toContain('failed')
    expect(out).not.toContain(KEY)
  })

  it('a cancelled run throws instead of falling through or answering', async () => {
    const c = new AbortController()
    const ledger = new MemoryLedger()
    const next = vi.fn(async () => ({ backend: 'ddgs', results: [] }))
    const run = createToolRegistry({
      gate: allowAllGate,
      tools: [
        webSearchTool({
          provider: async () =>
            chainedSearch([
              {
                name: 'tavily',
                search: (_q, o) =>
                  new Promise((_r, reject) => {
                    o.signal.addEventListener('abort', () => reject(o.signal.reason), {
                      once: true,
                    })
                    c.abort(new Error('cancelled'))
                  }),
              },
              { name: 'ddgs', search: next },
            ]),
        }),
      ],
    }).forRun({ runId, profileId })
    await expect(
      run.invoke(
        { stepIdx: 0, toolCallId: 'c1', toolName: 'web_search', input: { query: 'q' } },
        { ledger, signal: c.signal, allowPark: true },
      ),
    ).rejects.toThrow('cancelled')
    expect(next).not.toHaveBeenCalled()
  })

  it('times out a search that does not answer', async () => {
    vi.useFakeTimers()
    const hang = brave(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        }),
    )
    const pending = bind(hang, 500).call({ query: 'x' })
    await vi.advanceTimersByTimeAsync(501)
    expect(text(await pending)).toContain('timeout')
  })

  it('caps the query and the result count', async () => {
    const h = bind(brave(async () => json(braveBody)))
    expect(text(await h.call({ query: 'q'.repeat(401) }))).toContain('invalid_input')
    expect(text(await h.call({ query: 'q', count: 11 }))).toContain('invalid_input')
    expect(text(await h.call({ query: '  ' }))).toContain('invalid_input')
  })
})
