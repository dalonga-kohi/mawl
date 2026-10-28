import { describe, expect, it, vi } from 'vitest'
import { plain, readText, SEARCH_USER_AGENT, send } from './http.ts'
import { SearchFailedError, type SearchFetch } from './types.ts'

const signal = () => new AbortController().signal
const reason = (e: unknown) => (e instanceof SearchFailedError ? e.reason : e)

describe('search http', () => {
  it('sends a fixed honest user agent and refuses redirects, whatever the caller passed', async () => {
    const fetch = vi.fn<SearchFetch>(async () => new Response('ok'))
    await send(fetch, 'https://example.com/', { method: 'GET', redirect: 'follow' }, signal())
    const init = fetch.mock.calls[0]?.[1]
    expect(init?.redirect).toBe('error')
    expect(new Headers(init?.headers).get('user-agent')).toBe(SEARCH_USER_AGENT)
    expect(SEARCH_USER_AGENT).toMatch(/^Mawl\b/)
  })

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [432, 'rate_limited'],
    [433, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
    [404, 'unavailable'],
    [302, 'unavailable'],
  ] as const)('maps HTTP %i to %s', async (status, expected) => {
    const fetch: SearchFetch = async () => new Response(null, { status })
    const err = await send(fetch, 'https://example.com/', {}, signal()).catch((e: unknown) => e)
    expect(reason(err)).toBe(expected)
  })

  it('maps a network error to unavailable without its text', async () => {
    const fetch: SearchFetch = async () => {
      throw new TypeError('fetch failed: secret-detail')
    }
    const err = await send(fetch, 'https://example.com/', {}, signal()).catch((e: unknown) => e)
    expect(reason(err)).toBe('unavailable')
    expect(String(err)).not.toContain('secret-detail')
  })

  it('lets an abort through as is, so a cancelled run is never a backend failure', async () => {
    const c = new AbortController()
    const cause = new Error('cancelled')
    c.abort(cause)
    const fetch: SearchFetch = async (_u, init) => {
      throw init.signal?.reason
    }
    await expect(send(fetch, 'https://example.com/', {}, c.signal)).rejects.toBe(cause)
  })

  it('reads a body up to the cap and refuses a larger one as unavailable', async () => {
    expect(await readText(new Response('abc'), signal(), 3)).toBe('abc')
    const err = await readText(new Response('abcd'), signal(), 3).catch((e: unknown) => e)
    expect(reason(err)).toBe('unavailable')
  })

  it('refuses a declared content-length over the cap before reading', async () => {
    const res = new Response('abc', { headers: { 'content-length': '999999999' } })
    const err = await readText(res, signal(), 1000).catch((e: unknown) => e)
    expect(reason(err)).toBe('unavailable')
  })

  it('plain() strips tags, decodes named and numeric entities and caps the length', () => {
    expect(plain('a <b>bold</b> &amp; &#x27;q&#39; &#8212; &lt;x&gt;', 100)).toBe(
      "a bold & 'q' — <x>",
    )
    expect(plain('x'.repeat(10), 4)).toBe('xxxx…')
  })
})
