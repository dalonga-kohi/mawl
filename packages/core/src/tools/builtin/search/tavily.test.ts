import { describe, expect, it, vi } from 'vitest'
import { TAVILY_SEARCH_URL, tavilySearch } from './tavily.ts'
import { SearchFailedError, type SearchFetch } from './types.ts'

const KEY = 'tvly-test-key-123'
const signal = () => new AbortController().signal
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const body = {
  query: 'python web',
  answer: null,
  images: [],
  response_time: 0.4,
  results: [
    {
      title: 'Flask &amp; Django',
      url: 'https://example.com/flask',
      content: 'Two   frameworks <b>compared</b>',
      score: 0.9,
    },
    { title: 'Second', url: 'https://example.org/2', content: 'Two', score: 0.5 },
  ],
}

describe('tavilySearch', () => {
  it('posts the query as JSON with the key as a bearer token, and never in the url or body', async () => {
    const fetch = vi.fn<SearchFetch>(async () => json(body))
    const answer = await tavilySearch({ apiKey: KEY, fetch }).search('python web', {
      count: 2,
      signal: signal(),
    })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(TAVILY_SEARCH_URL)
    expect(TAVILY_SEARCH_URL).toBe('https://api.tavily.com/search')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`)
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      query: 'python web',
      max_results: 2,
      search_depth: 'basic',
    })
    expect(url).not.toContain(KEY)
    expect(String(init?.body)).not.toContain(KEY)
    expect(answer).toEqual({
      backend: 'tavily',
      results: [
        {
          title: 'Flask & Django',
          url: 'https://example.com/flask',
          snippet: 'Two frameworks compared',
        },
        { title: 'Second', url: 'https://example.org/2', snippet: 'Two' },
      ],
    })
  })

  it('answers an empty results list as no results', async () => {
    const fetch = vi.fn<SearchFetch>(async () => json({ ...body, results: [] }))
    expect(
      await tavilySearch({ apiKey: KEY, fetch }).search('x', { count: 5, signal: signal() }),
    ).toEqual({ backend: 'tavily', results: [] })
  })

  it('returns at most the asked count', async () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `t${i}`,
      url: `https://x.com/${i}`,
      content: '',
    }))
    const fetch = vi.fn<SearchFetch>(async () => json({ results }))
    const answer = await tavilySearch({ apiKey: KEY, fetch }).search('x', {
      count: 3,
      signal: signal(),
    })
    expect(answer.results).toHaveLength(3)
  })

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [432, 'rate_limited'],
    [433, 'rate_limited'],
    [500, 'unavailable'],
    [434, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, reason) => {
    const fetch = vi.fn<SearchFetch>(async () => json({ detail: { error: KEY } }, status))
    const err = await tavilySearch({ apiKey: KEY, fetch })
      .search('x', { count: 5, signal: signal() })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SearchFailedError)
    expect((err as SearchFailedError).reason).toBe(reason)
    expect(String(err)).not.toContain(KEY)
  })

  it.each([
    ['not JSON', new Response('<html>')],
    ['results not an array', json({ results: 'x' })],
    ['no results field', json({ query: 'x' })],
    ['a result without a url', json({ results: [{ title: 't' }] })],
  ])('treats %s as unavailable', async (_l, res) => {
    const err = await tavilySearch({ apiKey: KEY, fetch: async () => res })
      .search('x', { count: 5, signal: signal() })
      .catch((e: unknown) => e)
    expect((err as SearchFailedError).reason).toBe('unavailable')
  })
})
