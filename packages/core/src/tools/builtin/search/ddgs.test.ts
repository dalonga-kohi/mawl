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

  it('reports the bot challenge page as blocked, never as zero results', () => {
    expect(parseDdgsHtml(CHALLENGE)).toEqual({ kind: 'blocked' })
  })

  it.each([
    ['an empty body', ''],
    ['an unrelated page', '<html><body><p>Hello</p></body></html>'],
    ['a page with only ads', RESULTS.replaceAll('web-result', 'result--ad')],
  ])('reports %s as blocked (unrecognized), not as zero results', (_l, html) => {
    expect(parseDdgsHtml(html)).toEqual({ kind: 'blocked' })
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
    expect(reason(err)).toBe(_l === 'a 429' ? 'rate_limited' : 'unavailable')
  })
})
