import { decodeEntities, plain, readText, send } from './http.ts'
import {
  SearchFailedError,
  type SearchFetch,
  type SearchProvider,
  type SearchResult,
} from './types.ts'

/** DuckDuckGo's no-JavaScript results page (shape checked live 2026-10-28). */
export const DDGS_SEARCH_URL = 'https://html.duckduckgo.com/html/'

/** After DuckDuckGo blocks automated queries, no request is sent to it for this long. */
export const DDGS_COOL_DOWN_MS = 5 * 60_000

/**
 * What the html endpoint answered. `challenge`: the bot check ("anomaly") page. `unrecognized`:
 * neither results, nor the no-results marker, nor the challenge (an error page, a redesign).
 */
export type DdgsPage =
  | { kind: 'results'; results: SearchResult[] }
  | { kind: 'challenge' }
  | { kind: 'unrecognized' }

const RESULT_DIV = /<div\b([^>]*)>/gi
const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi
/** Anchored on the class inside the opening tag, so an enclosing `div` never swallows it. */
const SNIPPET = /<(a|div|td|span)\b([^>]*\bresult__snippet\b[^>]*)>([\s\S]*?)<\/\1\s*>/i
const NO_RESULTS = /\bclass\s*=\s*["'][^"']*\b(?:no-results|result--no-result)\b/i

/** The challenge page's wording, as served (case and line breaks vary). */
const CHALLENGE_WORDING = [
  /bots\s+use\s+duckduckgo\s+too/i,
  /confirm\s+this\s+search\s+was\s+made\s+by\s+a\s+human/i,
]
/**
 * The challenge page's markup: its class/id names (matched on attributes only, so a query echoed
 * in the page's input value does not count), or a form with a submit button.
 */
const CHALLENGE_MARKUP = [
  /<[^>]*\b(?:class|id)\s*=\s*["'][^"']*\b(?:anomaly-modal|challenge-form)/i,
  /<form\b[\s\S]*?(?:<button\b|\btype\s*=\s*["']?submit)[\s\S]*?<\/form\s*>/i,
]

/** Two signals: the wording and challenge markup, so a page that only quotes the text is not it. */
function isChallenge(html: string): boolean {
  return (
    CHALLENGE_WORDING.some((re) => re.test(html)) && CHALLENGE_MARKUP.some((re) => re.test(html))
  )
}

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
 * Parsed results always win (a snippet may quote the challenge wording). Without results, the
 * challenge page is `challenge`, and zero results count only when the page says so (its
 * no-results marker); anything else is `unrecognized`, so it never reads as an empty answer.
 */
export function parseDdgsHtml(html: string): DdgsPage {
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
  if (results.length > 0) return { kind: 'results', results }
  if (isChallenge(html)) return { kind: 'challenge' }
  if (NO_RESULTS.test(html)) return { kind: 'results', results }
  return { kind: 'unrecognized' }
}

export interface DdgsDeps {
  fetch: SearchFetch
  /** Clock for the cool-down. Default `Date.now`. */
  now?: () => number
  /** Default `DDGS_COOL_DOWN_MS`. */
  coolDownMs?: number
}

/**
 * DuckDuckGo (DDGS) backend: no key, best effort, the fallback that makes web search work with
 * nothing configured. Every failure is `unavailable` (there is no key to reject).
 *
 * A block (the challenge page, or HTTP 202, 401, 403 or 429) starts a cool-down: for
 * `coolDownMs` no request is sent and every search is `unavailable` at once, so a model that keeps
 * searching does not deepen the block. One request per search; the challenge is never answered.
 * The cool-down lives in this instance, so the host keeps one instance for the process.
 */
export function ddgsSearch({
  fetch,
  now = Date.now,
  coolDownMs = DDGS_COOL_DOWN_MS,
}: DdgsDeps): SearchProvider {
  let blockedUntil = Number.NEGATIVE_INFINITY
  const blocked = (): never => {
    blockedUntil = now() + coolDownMs
    throw new SearchFailedError('unavailable')
  }
  return {
    name: 'ddgs',
    async search(query, { count, signal }) {
      if (now() < blockedUntil) throw new SearchFailedError('unavailable')
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
        // 401/403 (`invalid_key`) and 429 (`rate_limited`) from a keyless endpoint are blocks.
        if (err instanceof SearchFailedError && err.reason !== 'unavailable') blocked()
        throw err
      }
      if (res.status === 202) {
        await res.body?.cancel().catch(() => {})
        blocked()
      }
      const parsed = parseDdgsHtml(await readText(res, signal))
      if (parsed.kind === 'challenge') blocked()
      if (parsed.kind !== 'results') throw new SearchFailedError('unavailable')
      return { backend: 'ddgs', results: parsed.results.slice(0, count) }
    },
  }
}
