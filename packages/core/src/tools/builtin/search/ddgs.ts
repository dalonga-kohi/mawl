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

/** One opening tag: its lower-case name, where it starts and ends, and its raw attribute text. */
interface Tag {
  name: string
  start: number
  /** Index just after the closing `>`. */
  end: number
  attrs: string
}

/** A tag whose attributes run longer than this is malformed and skipped. */
const MAX_TAG_CHARS = 4096

/**
 * Every opening tag, in one forward pass. Linear on hostile input: the next tag is searched only
 * after the previous tag's `>`, so no character is scanned twice, and a missing `>` ends the scan
 * (no later tag could close either). Tags inside comments or scripts may be read as tags; the
 * reader is tolerant, not a full HTML parser.
 */
function scanTags(html: string): Tag[] {
  const open = /<([a-z][a-z0-9]*)(?=[\s/>])/gi
  const tags: Tag[] = []
  for (;;) {
    const m = open.exec(html)
    if (!m) break
    const gt = html.indexOf('>', m.index)
    if (gt === -1) break
    if (gt - m.index <= MAX_TAG_CHARS) {
      tags.push({
        name: (m[1] ?? '').toLowerCase(),
        start: m.index,
        end: gt + 1,
        attrs: html.slice(m.index + m[0].length, gt),
      })
    }
    open.lastIndex = gt + 1
  }
  return tags
}

/** A quoted attribute's value; null when absent or when its quote is never closed. */
function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)
  return m ? (m[1] ?? m[2] ?? '') : null
}

const classes = (tag: Tag) => new Set((attr(tag.attrs, 'class') ?? '').split(/\s+/))

/** The text from `from` to the first `</name>` before `to`; null when the element never closes. */
function inner(html: string, name: string, from: number, to: number): string | null {
  const region = html.slice(from, to)
  const close = new RegExp(`</${name}\\s*>`, 'i').exec(region)
  return close ? region.slice(0, close.index) : null
}

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

/** The challenge page's wording, as served (case and line breaks vary). */
const CHALLENGE_WORDING = [
  /bots\s+use\s+duckduckgo\s+too/i,
  /confirm\s+this\s+search\s+was\s+made\s+by\s+a\s+human/i,
]

/**
 * The page text the wording is looked for in: without `<input>` tags and the first `<title>`,
 * where the query is echoed. Only the first title is searched for its end, so this stays linear.
 */
function wordingText(html: string, tags: readonly Tag[]): string {
  let out = ''
  let at = 0
  let titleSeen = false
  for (const tag of tags) {
    if (tag.start < at) continue
    if (tag.name === 'input') {
      out += html.slice(at, tag.start)
      at = tag.end
    } else if (tag.name === 'title' && !titleSeen) {
      titleSeen = true
      const text = inner(html, 'title', tag.end, html.length)
      out += html.slice(at, tag.start)
      at = tag.end + (text?.length ?? 0)
    }
  }
  return out + html.slice(at)
}

/**
 * Two signals, so a page that only quotes the text is not the challenge: its wording (outside the
 * echoed query) and challenge markup. Markup is the anomaly class names, the `challenge-form` id
 * or an `anomaly.js` form action; or, on a page that is not a results page (no `links` /
 * `serp__results` container, which every normal page has), a form with a submit button.
 */
function isChallenge(html: string, tags: readonly Tag[]): boolean {
  const text = wordingText(html, tags)
  if (!CHALLENGE_WORDING.some((re) => re.test(text))) return false
  let serp = false
  let form = false
  let submit = false
  for (const tag of tags) {
    const cls = classes(tag)
    const id = attr(tag.attrs, 'id')
    if ([...cls].some((c) => c.startsWith('anomaly-modal')) || id === 'challenge-form') return true
    if (tag.name === 'form' && /anomaly\.js/i.test(attr(tag.attrs, 'action') ?? '')) return true
    if (id === 'links' || cls.has('serp__results')) serp = true
    if (tag.name === 'form') form = true
    if (
      form &&
      (tag.name === 'button' ||
        (tag.name === 'input' && (attr(tag.attrs, 'type') ?? '').toLowerCase() === 'submit'))
    ) {
      submit = true
    }
  }
  return !serp && submit
}

/**
 * A small tolerant reader for the html endpoint, linear in the page size (no backtracking regex
 * over the page). Each result is a `div` with class `result`; its title is the `result__a` link
 * and its snippet the `result__snippet` element. Ads, results without a usable link and results
 * whose title link never closes are dropped. Parsed results always win (a snippet may quote the
 * challenge wording). Without results, the challenge page is `challenge`, and zero results count
 * only when the page says so (its no-results marker); anything else is `unrecognized`, so it never
 * reads as an empty answer.
 */
export function parseDdgsHtml(html: string): DdgsPage {
  const tags = scanTags(html)
  const starts: number[] = []
  let noResults = false
  tags.forEach((tag, i) => {
    const cls = classes(tag)
    if (cls.has('no-results') || cls.has('result--no-result')) noResults = true
    if (tag.name === 'div' && cls.has('result')) starts.push(i)
  })

  const results: SearchResult[] = []
  starts.forEach((first, n) => {
    const head = tags[first]
    if (!head) return
    const cls = classes(head)
    if (cls.has('result--ad') || cls.has('result--no-result')) return
    const last = starts[n + 1] ?? tags.length
    const blockEnd = tags[last]?.start ?? html.length
    let title: Tag | undefined
    let snippet: Tag | undefined
    for (let i = first + 1; i < last; i++) {
      const tag = tags[i]
      if (!tag) continue
      const c = classes(tag)
      if (!title && tag.name === 'a' && c.has('result__a')) title = tag
      if (!snippet && ['a', 'div', 'td', 'span'].includes(tag.name) && c.has('result__snippet')) {
        snippet = tag
      }
    }
    if (!title) return
    const href = attr(title.attrs, 'href')?.trim()
    if (!href) return
    const url = resolveLink(href)
    if (!url) return
    const text = inner(html, 'a', title.end, blockEnd)
    if (text === null) return
    const snippetText = snippet ? (inner(html, snippet.name, snippet.end, blockEnd) ?? '') : ''
    results.push({ title: plain(text, 200), url, snippet: plain(snippetText, 500) })
  })

  if (results.length > 0) return { kind: 'results', results }
  if (isChallenge(html, tags)) return { kind: 'challenge' }
  if (noResults) return { kind: 'results', results }
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
 *
 * Other failures (a network error, a refused redirect, a 5xx, an unrecognized page) start no
 * cool-down on purpose: they look the same as an outage or a redesign, not as DuckDuckGo
 * refusing us, and each search still sends DuckDuckGo at most one request.
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
