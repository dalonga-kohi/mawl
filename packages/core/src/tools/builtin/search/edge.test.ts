import { afterEach, describe, expect, it, vi } from 'vitest'
import { braveSearch } from './brave.ts'
import { chainedSearch } from './chain.ts'
import { DDGS_COOL_DOWN_MS, ddgsSearch, parseDdgsHtml } from './ddgs.ts'
import { decodeEntities, plain, readText, send } from './http.ts'
import { growthRatio, LINEAR_MAX_RATIO } from './scaling-test-util.ts'
import { tavilySearch } from './tavily.ts'
import {
  SearchFailedError,
  type SearchFetch,
  type SearchProvider,
  SearchUnavailableError,
} from './types.ts'

const signal = () => new AbortController().signal
const reason = (e: unknown) => (e instanceof SearchFailedError ? e.reason : e)
const opts = (count = 5) => ({ count, signal: signal() })

const hit = (href: string, title = 'T', snippet = '') =>
  `<div class="result results_links web-result"><h2 class="result__title"><a class="result__a" href="${href}">${title}</a></h2>` +
  `<a class="result__snippet" href="${href}">${snippet}</a></div>`
const doc = (...items: string[]) =>
  `<html><body><div id="links">${items.join('\n')}</div></body></html>`
const urlsOf = (html: string) => {
  const p = parseDdgsHtml(html)
  return p.kind === 'results' ? p.results.map((r) => r.url) : p.kind
}

afterEach(() => {
  vi.useRealTimers()
})

describe('parseDdgsHtml edge cases', () => {
  it('drops javascript:, data:, file: and mailto: links', () => {
    const html = doc(
      hit('javascript:alert(1)'),
      hit('data:text/html,hello'),
      hit('file:///etc/passwd'),
      hit('mailto:a@b.c'),
      hit('https://ok.example/'),
    )
    expect(urlsOf(html)).toEqual(['https://ok.example/'])
  })

  it('drops an entity-obfuscated javascript: link', () => {
    expect(urlsOf(doc(hit('java&#115;cript:alert(1)'), hit('https://ok.example/')))).toEqual([
      'https://ok.example/',
    ])
  })

  it('drops a /y.js ad-click link even when the result block carries no ad class', () => {
    const html = doc(
      hit('//duckduckgo.com/y.js?ad_domain=shop.example&u3=x'),
      hit('https://ok.example/'),
    )
    expect(urlsOf(html)).toEqual(['https://ok.example/'])
  })
  it('drops a redirect wrapper whose target is not http(s) or is missing or malformed', () => {
    const html = doc(
      hit('//duckduckgo.com/l/?uddg=javascript%3Aalert(1)'),
      hit('//duckduckgo.com/l/?rut=abc'),
      hit('//duckduckgo.com/l/?uddg=%2Frelative%2Fonly'),
      hit('//duckduckgo.com/l/?uddg=https%3A%2F%2Fgood.example%2Fa%3Fb%3D1'),
    )
    expect(urlsOf(html)).toEqual(['https://good.example/a?b=1'])
  })

  it('does not treat a lookalike host as DuckDuckGo', () => {
    // evil-duckduckgo.com is not a duckduckgo.com subdomain: the link is kept as is.
    expect(
      urlsOf(doc(hit('https://evil-duckduckgo.com/l/?uddg=https%3A%2F%2Fx.example%2F'))),
    ).toEqual(['https://evil-duckduckgo.com/l/?uddg=https%3A%2F%2Fx.example%2F'])
  })

  it('resolves a protocol-relative link to https and drops a path-only link', () => {
    expect(urlsOf(doc(hit('//cdn.example/x'), hit('/just/a/path')))).toEqual([
      'https://cdn.example/x',
      'https://duckduckgo.com/just/a/path',
    ])
  })

  it('decodes entities and keeps unicode in titles and snippets', () => {
    const p = parseDdgsHtml(
      doc(
        hit(
          'https://u.example/',
          'Caf&eacute; &amp; Ünï 日本語 &#x1F600; &#128512; &lt;b&gt;',
          'a&nbsp;b',
        ),
      ),
    )
    expect(p.kind).toBe('results')
    if (p.kind !== 'results') return
    expect(p.results[0]?.title).toBe('Caf&eacute; & Ünï 日本語 😀 😀 <b>')
    expect(p.results[0]?.snippet).toBe('a b')
  })

  it('leaves invalid numeric entities as text and never throws', () => {
    expect(decodeEntities('&#0; &#x110000; &#99999999999; &#xD800;')).toContain('&#0;')
    expect(() => decodeEntities('&#xD800;&#xDFFF;')).not.toThrow()
  })

  it('caps a title at 200 and a snippet at 500 characters without splitting a surrogate pair', () => {
    const p = parseDdgsHtml(doc(hit('https://u.example/', '😀'.repeat(300), 'x'.repeat(900))))
    if (p.kind !== 'results') throw new Error('expected results')
    const title = p.results[0]?.title ?? ''
    expect(title.endsWith('…')).toBe(true)
    expect(title.length).toBeLessThanOrEqual(201)
    expect(title).not.toMatch(/[\uD800-\uDBFF]…$/)
    expect(p.results[0]?.snippet.length).toBeLessThanOrEqual(501)
  })

  it('returns quickly on empty and truncated input', () => {
    expect(parseDdgsHtml('')).toEqual({ kind: 'unrecognized' })
    expect(
      parseDdgsHtml('<div class="result"><a class="result__a" href="https://a.example/'),
    ).toEqual({
      kind: 'unrecognized',
    })
  })

  // Scaling guards compare n with 4n (linear ~4x, quadratic ~16x) instead of a wall-clock budget,
  // which is flaky on slower CI runners. The old regex parser measured ~16x on the two tag cases.
  it('parses thousands of results in time linear in their number', () => {
    const page = (n: number) =>
      doc(...Array.from({ length: n }, (_, i) => hit(`https://e.example/${i}`)))
    expect(growthRatio(page, parseDdgsHtml, 1_250)).toBeLessThan(LINEAR_MAX_RATIO)
  })

  it('does not go quadratic on many unterminated <div tags (a 2 MiB page of them must not block)', () => {
    const page = (n: number) => '<div '.repeat(n)
    expect(growthRatio(page, parseDdgsHtml, 5_000)).toBeLessThan(LINEAR_MAX_RATIO)
  })

  it('does not go quadratic on many unterminated <a tags inside one result', () => {
    const page = (n: number) => `<div class="result">${'<a '.repeat(n)}`
    expect(growthRatio(page, parseDdgsHtml, 5_000)).toBeLessThan(LINEAR_MAX_RATIO)
  })

  it('drops a result with no href, an empty href, or an href broken by a stray ">"', () => {
    const noHref = `<div class="result"><a class="result__a">No link</a></div>`
    const empty = `<div class="result"><a class="result__a" href="">Empty</a></div>`
    const broken = `<div class="result"><a class="result__a" href="data:text/html,<b>x</b>">Broken</a></div>`
    expect(urlsOf(doc(noHref, empty, broken, hit('https://ok.example/')))).toEqual([
      'https://ok.example/',
    ])
  })
  it('keeps a result whose anchor is unterminated out, rather than throwing', () => {
    expect(
      urlsOf('<div class="result"><a class="result__a" href="https://a.example/">no close'),
    ).toBe('unrecognized')
  })

  it('keeps single-quoted attributes and attribute order variations', () => {
    const html = `<div class='result'><a href='https://q.example/' class='result__a'>Q</a></div>`
    expect(urlsOf(html)).toEqual(['https://q.example/'])
  })

  it('reads a result in a div whose class merely contains the word result as a different token', () => {
    const html = `<div class="results_links_deep"><a class="result__a" href="https://x.example/">X</a></div>`
    expect(parseDdgsHtml(html).kind).toBe('unrecognized')
  })

  it('does not report a challenge for a results page whose snippet quotes the challenge wording', () => {
    const html = doc(
      hit(
        'https://a.example/',
        'A',
        'bots use DuckDuckGo too; confirm this search was made by a human',
      ),
      '<form><button>x</button></form>',
    )
    expect(parseDdgsHtml(html).kind).toBe('results')
  })
})

describe('ddgsSearch edge cases', () => {
  const okPage = () => new Response(doc(hit('https://a.example/'), hit('https://b.example/')))

  it('returns an empty list for count 0 and caps at count', async () => {
    const fetch: SearchFetch = async () => okPage()
    const p = ddgsSearch({ fetch })
    expect((await p.search('q', opts(0))).results).toEqual([])
    expect((await p.search('q', opts(1))).results).toHaveLength(1)
  })

  it('sends the query form-encoded, unicode and reserved characters intact', async () => {
    const fetch = vi.fn<SearchFetch>(async () => okPage())
    await ddgsSearch({ fetch }).search('日本 & a=b+c "x"', opts())
    const body = String(fetch.mock.calls[0]?.[1].body)
    expect(new URLSearchParams(body).get('q')).toBe('日本 & a=b+c "x"')
  })

  it('allows a request again exactly when the cool-down ends, and a re-block restarts it', async () => {
    let t = 1_000
    let blocks = 1
    const fetch = vi.fn<SearchFetch>(async () =>
      blocks-- > 0 ? new Response('', { status: 429 }) : okPage(),
    )
    const p = ddgsSearch({ fetch, now: () => t })
    expect(reason(await p.search('q', opts()).catch((e) => e))).toBe('unavailable')
    expect(fetch).toHaveBeenCalledTimes(1)
    t += DDGS_COOL_DOWN_MS - 1
    await expect(p.search('q', opts())).rejects.toBeInstanceOf(SearchFailedError)
    expect(fetch).toHaveBeenCalledTimes(1)
    t += 1
    expect((await p.search('q', opts())).results).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('does not extend the cool-down when searches are refused during it', async () => {
    let t = 0
    const fetch = vi.fn<SearchFetch>(
      async (): Promise<Response> => new Response('', { status: 403 }),
    )
    const p = ddgsSearch({ fetch, now: () => t, coolDownMs: 100 })
    await p.search('q', opts()).catch(() => {})
    t = 50
    await p.search('q', opts()).catch(() => {})
    t = 100
    fetch.mockImplementation(async () => okPage())
    expect((await p.search('q', opts())).backend).toBe('ddgs')
  })

  it('does not start a cool-down for a network error or a 500', async () => {
    const fetch = vi
      .fn<SearchFetch>()
      .mockRejectedValueOnce(new TypeError('boom'))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(okPage())
    const p = ddgsSearch({ fetch, now: () => 0 })
    expect(reason(await p.search('q', opts()).catch((e) => e))).toBe('unavailable')
    expect(reason(await p.search('q', opts()).catch((e) => e))).toBe('unavailable')
    expect((await p.search('q', opts())).results).toHaveLength(2)
  })

  it('treats an HTML error page with status 200 as unavailable without a cool-down', async () => {
    const fetch = vi
      .fn<SearchFetch>()
      .mockResolvedValueOnce(new Response('<html>502 bad gateway</html>'))
      .mockResolvedValueOnce(okPage())
    const p = ddgsSearch({ fetch, now: () => 0 })
    expect(reason(await p.search('q', opts()).catch((e) => e))).toBe('unavailable')
    expect((await p.search('q', opts())).results).toHaveLength(2)
  })

  it('surfaces a caller abort as the abort, not as a block', async () => {
    const ac = new AbortController()
    const fetch: SearchFetch = (_u, init) =>
      new Promise((_res, rej) => {
        init.signal?.addEventListener('abort', () => rej(init.signal?.reason))
      })
    const p = ddgsSearch({ fetch, now: () => 0 })
    const pending = p.search('q', { count: 1, signal: ac.signal })
    ac.abort(new Error('stop'))
    await expect(pending).rejects.toThrow('stop')
  })
})

describe('http helpers edge cases', () => {
  const stream = (chunks: Uint8Array[]) =>
    new Response(
      new ReadableStream({
        start(c) {
          for (const ch of chunks) c.enqueue(ch)
          c.close()
        },
      }),
    )

  it('accepts a body of exactly the cap and refuses one byte more', async () => {
    const at = stream([new Uint8Array(10).fill(97)])
    expect(await readText(at, signal(), 10)).toBe('a'.repeat(10))
    const over = stream([new Uint8Array(5).fill(97), new Uint8Array(6).fill(97)])
    await expect(readText(over, signal(), 10)).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('refuses at the default 2 MiB cap boundary by content-length', async () => {
    const mk = (n: number) => new Response('x', { headers: { 'content-length': String(n) } })
    expect(await readText(mk(2 * 1024 * 1024), signal())).toBe('x')
    await expect(readText(mk(2 * 1024 * 1024 + 1), signal())).rejects.toBeInstanceOf(
      SearchFailedError,
    )
  })

  it('still enforces the cap when content-length lies low', async () => {
    const res = new Response(new Uint8Array(50).fill(97), { headers: { 'content-length': '1' } })
    await expect(readText(res, signal(), 10)).rejects.toBeInstanceOf(SearchFailedError)
  })

  it('decodes a multi-byte character split across chunks', async () => {
    const bytes = new TextEncoder().encode('日本')
    const res = stream([bytes.slice(0, 2), bytes.slice(2, 4), bytes.slice(4)])
    expect(await readText(res, signal())).toBe('日本')
  })

  it('maps a stream that errors to unavailable', async () => {
    const res = new Response(
      new ReadableStream({
        start(c) {
          c.error(new Error('reset'))
        },
      }),
    )
    await expect(readText(res, signal())).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('maps statuses to closed reasons and refuses redirects', async () => {
    const statusOf = async (status: number) => {
      const fetch = vi.fn<SearchFetch>(async () => new Response('secret-echo', { status }))
      const err = await send(fetch, 'https://x.example/', {}, signal()).catch((e) => e)
      return { reason: reason(err), init: fetch.mock.calls[0]?.[1], msg: String(err.message) }
    }
    expect((await statusOf(401)).reason).toBe('invalid_key')
    expect((await statusOf(403)).reason).toBe('invalid_key')
    expect((await statusOf(429)).reason).toBe('rate_limited')
    expect((await statusOf(432)).reason).toBe('rate_limited')
    expect((await statusOf(433)).reason).toBe('rate_limited')
    expect((await statusOf(500)).reason).toBe('unavailable')
    expect((await statusOf(404)).reason).toBe('unavailable')
    const r = await statusOf(302)
    expect(r.reason).toBe('unavailable')
    expect(r.init?.redirect).toBe('error')
    expect(r.msg).not.toContain('secret-echo')
  })

  it('does not echo a network error message (it may contain the key)', async () => {
    const fetch: SearchFetch = async () => {
      throw new Error('connect failed for Bearer tvly-SECRET')
    }
    const err = await send(fetch, 'https://x.example/', {}, signal()).catch((e) => e)
    expect(String(err.message)).not.toContain('SECRET')
  })

  it('plain strips tags (even unterminated), collapses whitespace and handles empty input', () => {
    expect(plain('', 10)).toBe('')
    expect(plain('<b>a</b>\n\t b   c<i', 50)).toBe('a b c<i')
    expect(plain('x'.repeat(10), 5)).toBe('xxxxx…')
  })
})

describe('keyed backends with odd JSON', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
  const tavily = (res: () => Response) =>
    tavilySearch({ apiKey: 'tvly-K', fetch: async () => res() })
  const brave = (res: () => Response) => braveSearch({ apiKey: 'BSA-K', fetch: async () => res() })
  const fails = async (p: SearchProvider) => reason(await p.search('q', opts()).catch((e) => e))

  it.each([
    ['null body', null],
    ['an array', []],
    ['results null', { results: null }],
    ['results an object', { results: {} }],
    ['a result with a numeric title', { results: [{ title: 1, url: 'https://a.example/' }] }],
    ['a result without a url', { results: [{ title: 'a' }] }],
    ['no results key', {}],
  ])('tavily: %s is unavailable', async (_n, body) => {
    expect(await fails(tavily(() => json(body)))).toBe('unavailable')
  })

  it.each([
    ['null body', null],
    ['an array', []],
    ['results an object', { web: { results: {} } }],
    [
      'a result with null title',
      { web: { results: [{ title: null, url: 'https://a.example/' }] } },
    ],
    ['a result without a url', { web: { results: [{ title: 'a' }] } }],
  ])('brave: %s is unavailable', async (_n, body) => {
    expect(await fails(brave(() => json(body)))).toBe('unavailable')
  })

  it('brave: a missing web section is an empty answer, not a failure', async () => {
    expect((await brave(() => json({})).search('q', opts())).results).toEqual([])
    expect((await brave(() => json({ web: {} })).search('q', opts())).results).toEqual([])
  })

  it('both: non-JSON and empty bodies are unavailable', async () => {
    expect(await fails(tavily(() => new Response('<html>')))).toBe('unavailable')
    expect(await fails(brave(() => new Response('')))).toBe('unavailable')
  })

  it('both: cap the number of results at count even if the backend over-delivers', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      title: `t${i}`,
      url: `https://e.example/${i}`,
      content: 'c',
      description: 'd',
    }))
    expect((await tavily(() => json({ results: many })).search('q', opts(3))).results).toHaveLength(
      3,
    )
    expect(
      (await brave(() => json({ web: { results: many } })).search('q', opts(3))).results,
    ).toHaveLength(3)
  })

  it('both: strip markup and decode entities in titles and snippets', async () => {
    const t = await tavily(() =>
      json({
        results: [
          { title: '<b>A</b> &amp; B', url: 'https://a.example/', content: '<p>x&quot;y</p>' },
        ],
      }),
    ).search('q', opts())
    expect(t.results[0]).toEqual({ title: 'A & B', url: 'https://a.example/', snippet: 'x"y' })
  })

  it('tavily: keeps the key out of the url and body; brave keeps it out of the url', async () => {
    const tf = vi.fn<SearchFetch>(async () => json({ results: [] }))
    await tavilySearch({ apiKey: 'tvly-KEY', fetch: tf }).search('q', opts())
    expect(tf.mock.calls[0]?.[0]).not.toContain('KEY')
    expect(String(tf.mock.calls[0]?.[1].body)).not.toContain('KEY')
    const bf = vi.fn<SearchFetch>(async () => json({}))
    await braveSearch({ apiKey: 'BSA-KEY', fetch: bf }).search('q&x=1 日本', opts())
    expect(bf.mock.calls[0]?.[0]).not.toContain('KEY')
    expect(new URL(String(bf.mock.calls[0]?.[0])).searchParams.get('q')).toBe('q&x=1 日本')
  })

  it('tavily and brave: result urls that are not http(s) are dropped', async () => {
    const body = [
      { title: 'bad', url: 'javascript:alert(1)', content: '', description: '' },
      { title: 'ok', url: 'https://ok.example/', content: '', description: '' },
    ]
    const t = await tavily(() => json({ results: body })).search('q', opts())
    const b = await brave(() => json({ web: { results: body } })).search('q', opts())
    expect(t.results.map((r) => r.url)).toEqual(['https://ok.example/'])
    expect(b.results.map((r) => r.url)).toEqual(['https://ok.example/'])
  })
})

describe('chainedSearch edge cases', () => {
  const named = (name: string, impl: SearchProvider['search']): SearchProvider => ({
    name,
    search: impl,
  })
  const ok = (name: string) => named(name, async () => ({ backend: name, results: [] }))
  const failWith = (name: string, r: 'invalid_key' | 'rate_limited' | 'unavailable') =>
    named(name, async () => {
      throw new SearchFailedError(r)
    })

  it('with no providers fails with an empty failure list', async () => {
    const err = await chainedSearch([])
      .search('q', opts())
      .catch((e) => e)
    expect(err).toBeInstanceOf(SearchUnavailableError)
    expect(err.failures).toEqual([])
  })

  it('a non-search error propagates at once and later providers are not tried', async () => {
    const later = vi.fn(async () => ({ backend: 'later', results: [] }))
    const chain = chainedSearch([
      failWith('a', 'unavailable'),
      named('b', async () => {
        throw new TypeError('bug')
      }),
      named('later', later),
    ])
    await expect(chain.search('q', opts())).rejects.toThrow(TypeError)
    expect(later).not.toHaveBeenCalled()
  })

  it('a caller abort during the first backend stops the chain without trying the next', async () => {
    const ac = new AbortController()
    const second = vi.fn(async () => ({ backend: 'b', results: [] }))
    const first = named(
      'a',
      (_q, { signal: s }) =>
        new Promise((_res, rej) => s.addEventListener('abort', () => rej(s.reason))),
    )
    const pending = chainedSearch([first, named('b', second)]).search('q', {
      count: 1,
      signal: ac.signal,
    })
    ac.abort(new Error('user stop'))
    await expect(pending).rejects.toThrow('user stop')
    expect(second).not.toHaveBeenCalled()
  })

  it('does not call any backend when the signal is already aborted', async () => {
    const a = vi.fn(async () => ({ backend: 'a', results: [] }))
    const ac = new AbortController()
    ac.abort(new Error('early'))
    await expect(
      chainedSearch([named('a', a)]).search('q', { count: 1, signal: ac.signal }),
    ).rejects.toThrow('early')
    expect(a).not.toHaveBeenCalled()
  })

  it('a backend that outlives its own timeout is skipped, and the next one answers', async () => {
    vi.useFakeTimers()
    const hang = named(
      'slow',
      (_q, { signal: s }) =>
        new Promise((_res, rej) => s.addEventListener('abort', () => rej(s.reason))),
    )
    const pending = chainedSearch([hang, ok('next')], { backendTimeoutMs: 1_000 }).search(
      'q',
      opts(),
    )
    await vi.advanceTimersByTimeAsync(1_000)
    expect((await pending).backend).toBe('next')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reports a timed-out backend as unavailable in the final failure list', async () => {
    vi.useFakeTimers()
    const hang = named(
      'slow',
      (_q, { signal: s }) =>
        new Promise((_res, rej) => s.addEventListener('abort', () => rej(s.reason))),
    )
    const pending = chainedSearch([failWith('k', 'invalid_key'), hang], {
      backendTimeoutMs: 50,
    })
      .search('q', opts())
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(60)
    const err = await pending
    expect(err).toBeInstanceOf(SearchUnavailableError)
    expect(err.failures).toEqual([
      { backend: 'k', reason: 'invalid_key' },
      { backend: 'slow', reason: 'unavailable' },
    ])
  })

  it('a caller abort that lands during the backend timeout window wins over the timeout', async () => {
    vi.useFakeTimers()
    const ac = new AbortController()
    const hang = named(
      'slow',
      (_q, { signal: s }) =>
        new Promise((_res, rej) => s.addEventListener('abort', () => rej(s.reason))),
    )
    const next = vi.fn(async () => ({ backend: 'n', results: [] }))
    const pending = chainedSearch([hang, named('n', next)], { backendTimeoutMs: 1_000 })
      .search('q', { count: 1, signal: ac.signal })
      .catch((e) => e)
    await vi.advanceTimersByTimeAsync(500)
    ac.abort(new Error('user'))
    expect(String((await pending).message)).toBe('user')
    expect(next).not.toHaveBeenCalled()
  })

  it('names the chain after its backends in order', () => {
    expect(chainedSearch([ok('tavily'), ok('brave'), ok('ddgs')]).name).toBe('tavily,brave,ddgs')
  })

  it('an empty answer from the first backend is final and later backends are not tried', async () => {
    const later = vi.fn(async () => ({ backend: 'b', results: [] }))
    const res = await chainedSearch([ok('a'), named('b', later)]).search('q', opts())
    expect(res.backend).toBe('a')
    expect(later).not.toHaveBeenCalled()
  })
})
