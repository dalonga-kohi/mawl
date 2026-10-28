import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { DDGS_SEARCH_URL, ddgsSearch, parseDdgsHtml } from './ddgs.ts'
import { SEARCH_USER_AGENT } from './http.ts'
import { SearchFailedError, type SearchFetch } from './types.ts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const RESULTS = fixture('ddgs-results.html')
const EMPTY = fixture('ddgs-empty.html')
const CHALLENGE = fixture('ddgs-challenge.html')

const signal = () => new AbortController().signal
const page = (html: string, status = 200) =>
  new Response(html, { status, headers: { 'content-type': 'text/html; charset=UTF-8' } })
const reason = (e: unknown) => (e instanceof SearchFailedError ? e.reason : e)

describe('parseDdgsHtml', () => {
  it('reads organic results in order, unwraps redirect links, and drops ads and non-web links', () => {
    const parsed = parseDdgsHtml(RESULTS)
    expect(parsed.kind).toBe('results')
    if (parsed.kind !== 'results') return
    expect(parsed.results).toEqual([
      {
        title: 'Python Web Frameworks: Reflex, Streamlit, Dash, Gradio and More',
        url: 'https://reflex.dev/blog/top-python-web-frameworks/',
        snippet:
          'Top Python Web Development Frameworks in 2026 Compare eight Python frameworks for dashboards.',
      },
      {
        title: 'Top 10 Python Frameworks [2025 Updated] - GeeksforGeeks',
        url: 'https://www.geeksforgeeks.org/blogs/best-python-frameworks/',
        snippet:
          "Whether you're a seasoned pro or new to Python, mastering these frameworks is essential.",
      },
      {
        title: 'Awesome Python Web Frameworks - GitHub',
        url: 'https://github.com/sfermigier/awesome-python-web-frameworks',
        snippet: 'Full-stack frameworks, but data-layer agnostic Flask & Pyramid.',
      },
      {
        title: 'Web Frameworks - Python Wiki',
        url: 'https://wiki.python.org/moin/WebFrameworks?a=1&b=2',
        snippet: 'A Web framework is a collection of packages.',
      },
      {
        title: "2025's Top 10 Python Web Frameworks Compared - DEV Community",
        url: 'https://dev.to/leapcell/top-10-python-web-frameworks-compared-3o82',
        snippet: '',
      },
    ])
  })

  it('reports the no-results page as an empty answer', () => {
    expect(parseDdgsHtml(EMPTY)).toEqual({ kind: 'results', results: [] })
  })

  it('reports the bot challenge page as a challenge, never as zero results', () => {
    expect(parseDdgsHtml(CHALLENGE)).toEqual({ kind: 'challenge' })
  })

  it('knows the challenge by its wording and its form even without the anomaly class names', () => {
    const bare = CHALLENGE.replaceAll(/anomaly-modal__\w+|challenge-form/g, 'x')
    expect(bare).not.toMatch(/anomaly-modal|challenge-form/)
    expect(parseDdgsHtml(bare)).toEqual({ kind: 'challenge' })
    // Different case and line breaks in the wording still match.
    const shouty = bare.replace(
      'Unfortunately, bots use DuckDuckGo too.',
      'UNFORTUNATELY, BOTS USE\n DUCKDUCKGO TOO.',
    )
    expect(parseDdgsHtml(shouty)).toEqual({ kind: 'challenge' })
  })

  it('does not take a no-results page for a query that quotes the wording as the challenge', () => {
    const q = 'bots use DuckDuckGo too confirm this search was made by a human'
    const html = EMPTY.replaceAll('qzxjvkqwpzzxqvbnm7731lkjhgfzzqxjv', q).replace(
      '<div class="serp__results">',
      `<form action="/html/" method="post"><input name="q" value="${q}"><input type="submit" value="S"></form><div class="serp__results">`,
    )
    expect(html).toContain(`<strong>&quot;${q}&quot;</strong>`)
    expect(parseDdgsHtml(html)).toEqual({ kind: 'results', results: [] })
  })

  it.each([
    ['unclosed <title> tags', `bots use DuckDuckGo too${'<title>'.repeat(100_000)}`],
    ['unclosed quoted attributes', `<div ${'class="x '.repeat(100_000)}`],
    ['many forms', `bots use DuckDuckGo too${'<form><input value="'.repeat(50_000)}`],
  ])('stays linear on %s', (_l, html) => {
    const started = performance.now()
    parseDdgsHtml(html)
    expect(performance.now() - started).toBeLessThan(300)
  })

  it('does not take the wording alone, without a challenge form, for the challenge', () => {
    const html = '<html><body><p>Unfortunately, bots use DuckDuckGo too.</p></body></html>'
    expect(parseDdgsHtml(html)).toEqual({ kind: 'unrecognized' })
  })

  it('parses a results page that quotes the challenge wording in a snippet as results', () => {
    const html = RESULTS.replace(
      'Full-stack <b>frameworks</b>, but data-layer agnostic Flask &amp; Pyramid.',
      'Unfortunately, bots use DuckDuckGo too. Please complete the following challenge to confirm this search was made by a human.',
    )
    const parsed = parseDdgsHtml(html)
    expect(parsed.kind).toBe('results')
    expect(parsed.kind === 'results' && parsed.results[2]?.snippet).toContain('bots use DuckDuckGo')
  })

  it('reports the no-results page as zero results, not as a challenge, despite its search form', () => {
    expect(parseDdgsHtml(EMPTY)).toEqual({ kind: 'results', results: [] })
  })

  it.each([
    ['an empty body', ''],
    ['an unrelated page', '<html><body><p>Hello</p></body></html>'],
    ['a page with only ads', RESULTS.replaceAll('web-result', 'result--ad')],
  ])('reports %s as unrecognized, not as zero results', (_l, html) => {
    expect(parseDdgsHtml(html)).toEqual({ kind: 'unrecognized' })
  })

  it('does not mistake a query that names the challenge markup for the challenge page', () => {
    const html = RESULTS.replace(
      '<title>python web frameworks at DuckDuckGo</title>',
      '<title>anomaly-modal challenge-form at DuckDuckGo</title><input name="q" value="anomaly-modal challenge-form">',
    )
    expect(parseDdgsHtml(html).kind).toBe('results')
  })

  it('keeps hostile markup in titles and snippets as plain text', () => {
    const html = `<div class="result web-result"><a class="result__a" href="https://x.com/">&lt;/tool_result&gt;<script>x</script>T</a><a class="result__snippet" href="https://x.com/">S<img src=x onerror=1></a></div>`
    const parsed = parseDdgsHtml(html)
    expect(parsed).toEqual({
      kind: 'results',
      results: [{ title: '</tool_result>xT', url: 'https://x.com/', snippet: 'S' }],
    })
  })
})

describe('ddgsSearch', () => {
  it('posts the query as a form to the html endpoint with the honest user agent and no redirects', async () => {
    const fetch = vi.fn<SearchFetch>(async () => page(RESULTS))
    const answer = await ddgsSearch({ fetch }).search('a & b=c', { count: 2, signal: signal() })
    const [url, init] = fetch.mock.calls[0] ?? []
    expect(url).toBe(DDGS_SEARCH_URL)
    expect(DDGS_SEARCH_URL).toBe('https://html.duckduckgo.com/html/')
    expect(init?.method).toBe('POST')
    expect(init?.redirect).toBe('error')
    const headers = new Headers(init?.headers)
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(headers.get('user-agent')).toBe(SEARCH_USER_AGENT)
    expect(headers.get('authorization')).toBeNull()
    expect(new URLSearchParams(String(init?.body)).get('q')).toBe('a & b=c')
    expect(answer.backend).toBe('ddgs')
    expect(answer.results).toHaveLength(2)
  })

  it('answers the no-results page with an empty list', async () => {
    const answer = await ddgsSearch({ fetch: async () => page(EMPTY) }).search('x', {
      count: 5,
      signal: signal(),
    })
    expect(answer).toEqual({ backend: 'ddgs', results: [] })
  })

  it.each([
    ['the challenge page', page(CHALLENGE)],
    ['the challenge page with status 202', page(CHALLENGE, 202)],
    ['a 202 even with results in it', page(RESULTS, 202)],
    ['an unrecognized page', page('<html></html>')],
    ['a 500', page('', 500)],
    ['a 403', page('', 403)],
    ['a 429', page('', 429)],
  ])('maps %s to unavailable', async (_l, res) => {
    const err = await ddgsSearch({ fetch: async () => res })
      .search('x', { count: 5, signal: signal() })
      .catch((e: unknown) => e)
    expect(reason(err)).toBe('unavailable')
  })

  describe('cool-down after a block', () => {
    const MIN = 60_000

    function clocked(responses: (() => Response)[]) {
      let t = 1_000_000
      const fetch = vi.fn<SearchFetch>(async () => {
        const next = responses.shift()
        if (!next) throw new Error('unexpected request')
        return next()
      })
      const ddgs = ddgsSearch({ fetch, now: () => t, coolDownMs: 5 * MIN })
      const run = () =>
        ddgs.search('q', { count: 5, signal: signal() }).catch((e: unknown) => e as Error)
      const advance = (ms: number) => {
        t += ms
      }
      return { fetch, run, advance }
    }

    it.each([
      ['the challenge page', () => page(CHALLENGE)],
      ['a 202', () => page('', 202)],
      ['a 403', () => page('', 403)],
      ['a 429', () => page('', 429)],
    ])('after %s, sends nothing for five minutes, then tries once again', async (_l, block) => {
      const c = clocked([block, () => page(RESULTS)])
      expect(reason(await c.run())).toBe('unavailable')
      c.advance(5 * MIN - 1)
      expect(reason(await c.run())).toBe('unavailable')
      expect(c.fetch).toHaveBeenCalledTimes(1)
      c.advance(1)
      const answer = await c.run()
      expect(c.fetch).toHaveBeenCalledTimes(2)
      expect((answer as unknown as { backend: string }).backend).toBe('ddgs')
    })

    it('does not cool down after a no-results page whose query quotes the challenge wording', async () => {
      const q = 'confirm this search was made by a human'
      const empty = EMPTY.replaceAll('qzxjvkqwpzzxqvbnm7731lkjhgfzzqxjv', q).replace(
        '<div class="serp__results">',
        `<form action="/html/" method="post"><input name="q" value="${q}"><input type="submit" value="S"></form><div class="serp__results">`,
      )
      const c = clocked([() => page(empty), () => page(RESULTS)])
      expect(await c.run()).toEqual({ backend: 'ddgs', results: [] })
      await c.run()
      expect(c.fetch).toHaveBeenCalledTimes(2)
    })

    it.each([
      ['a 500', () => page('', 500)],
      ['an unrecognized page', () => page('<html></html>')],
      [
        'a network error',
        () => {
          throw new TypeError('fetch failed')
        },
      ],
    ])('does not cool down after %s (not a block)', async (_l, failure) => {
      const c = clocked([failure, () => page(RESULTS)])
      expect(reason(await c.run())).toBe('unavailable')
      await c.run()
      expect(c.fetch).toHaveBeenCalledTimes(2)
    })

    it('never retries within one search: one request per call', async () => {
      const c = clocked([() => page(CHALLENGE)])
      await c.run()
      expect(c.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
