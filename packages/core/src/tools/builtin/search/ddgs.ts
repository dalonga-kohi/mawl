import { decodeEntities, plain, readText, send } from './http.ts'
import {
  SearchFailedError,
  type SearchFetch,
  type SearchProvider,
  type SearchResult,
} from './types.ts'

/** DuckDuckGo's no-JavaScript results page (shape checked live 2026-10-28). */
export const DDGS_SEARCH_URL = 'https://html.duckduckgo.com/html/'

export type DdgsPage = { kind: 'results'; results: SearchResult[] } | { kind: 'blocked' }

const RESULT_DIV = /<div\b([^>]*)>/gi
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
/** Anchored on the class inside the opening tag, so an enclosing `div` never swallows it. */
const SNIPPET = /<(a|div|td|span)\b([^>]*\bresult__snippet\b[^>]*)>([\s\S]*?)<\/\1\s*>/i
/**
 * The bot challenge ("anomaly") page DuckDuckGo serves instead of results. Matched on class/id
 * attributes only, so a query that names them (echoed in the page's input value) is not a match.
 */
const CHALLENGE = /<[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:anomaly-modal|challenge-form)/i
const NO_RESULTS = /\bclass\s*=\s*["'][^"']*\b(?:no-results|result--no-result)\b/i

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? '') : null
}

const classes = (attrs: string) => new Set((attr(attrs, 'class') ?? '').split(/\s+/))

/**
 * The real target of a result link: DuckDuckGo may wrap it as `//duckduckgo.com/l/?uddg=<url>`.
 * Ad links (`/y.js`) and anything that is not http(s) give null.
 */
function resolveLink(raw: string): string | null {
  let url: URL
  try {
    url = new URL(decodeEntities(raw).trim(), 'https://duckduckgo.com/')
    if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
      if (url.pathname === '/y.js') return null
      if (url.pathname === '/l/') {
        const target = url.searchParams.get('uddg')
        if (!target) return null
        url = new URL(target)
      }
    }
  } catch {
    return null
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
}

/**
 * A small tolerant reader for the html endpoint. Each result is a `div` with class `result`; its
 * title is the `result__a` link and its snippet the `result__snippet` element. Ads are dropped.
 * Zero results count only when the page says so (its no-results marker); a page with neither
 * results nor that marker (the bot challenge, a redesign) is `blocked`, so it never reads as an
 * empty answer.
 */
export function parseDdgsHtml(html: string): DdgsPage {
  if (CHALLENGE.test(html)) return { kind: 'blocked' }
  const starts: { at: number; classes: Set<string> }[] = []
  for (const m of html.matchAll(RESULT_DIV)) {
    const cls = classes(m[1] ?? '')
    if (cls.has('result')) starts.push({ at: m.index, classes: cls })
  }
  const results: SearchResult[] = []
  starts.forEach((start, i) => {
    if (start.classes.has('result--ad') || start.classes.has('result--no-result')) return
    const block = html.slice(start.at, starts[i + 1]?.at ?? html.length)
    let title: { href: string; text: string } | null = null
    for (const a of block.matchAll(ANCHOR)) {
      const attrs = a[1] ?? ''
      if (classes(attrs).has('result__a')) {
        title = { href: attr(attrs, 'href') ?? '', text: a[2] ?? '' }
        break
      }
    }
    if (!title) return
    const url = resolveLink(title.href)
    if (!url) return
    const snippet = SNIPPET.exec(block)?.[3] ?? ''
    results.push({ title: plain(title.text, 200), url, snippet: plain(snippet, 500) })
  })
  if (results.length > 0 || NO_RESULTS.test(html)) return { kind: 'results', results }
  return { kind: 'blocked' }
}

/**
 * DuckDuckGo (DDGS) backend: no key, best effort, the fallback that makes web search work with
 * nothing configured. A 202 or a page that is not a results page means DuckDuckGo is refusing
 * automated queries for now: `unavailable`. There is no key, so a 401/403 is `unavailable` too.
 */
export function ddgsSearch({ fetch }: { fetch: SearchFetch }): SearchProvider {
  return {
    name: 'ddgs',
    async search(query, { count, signal }) {
      let res: Response
      try {
        res = await send(
          fetch,
          DDGS_SEARCH_URL,
          {
            method: 'POST',
            headers: {
              accept: 'text/html',
              'content-type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({ q: query }).toString(),
          },
          signal,
        )
      } catch (err) {
        if (err instanceof SearchFailedError && err.reason === 'invalid_key') {
          throw new SearchFailedError('unavailable')
        }
        throw err
      }
      if (res.status === 202) {
        await res.body?.cancel().catch(() => {})
        throw new SearchFailedError('unavailable')
      }
      const parsed = parseDdgsHtml(await readText(res, signal))
      if (parsed.kind === 'blocked') throw new SearchFailedError('unavailable')
      return { backend: 'ddgs', results: parsed.results.slice(0, count) }
    },
  }
}
