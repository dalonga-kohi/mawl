import { cut } from '../../text.ts'
import { SearchFailedError, type SearchFetch } from './types.ts'

/** Sent on every search request. Honest: it names Mawl, never a browser. */
export const SEARCH_USER_AGENT = 'Mawl (+https://github.com/dalonga-kohi/mawl)'

/** A search response larger than this is refused (a results page is tens of KB). */
export const SEARCH_MAX_BYTES = 2 * 1024 * 1024

/**
 * Sends one search request: redirects refused (a key can never follow one elsewhere), the honest
 * user agent, and the caller's signal. A network error becomes `unavailable` without its text; an
 * abort propagates untouched. Non-2xx statuses map to a closed reason: 401/403 `invalid_key`,
 * 429 and Tavily's plan limits 432/433 `rate_limited`, anything else `unavailable`.
 */
export async function send(
  fetch: SearchFetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('user-agent', SEARCH_USER_AGENT)
  let res: Response
  try {
    res = await fetch(url, { ...init, headers, signal, redirect: 'error' })
  } catch (err) {
    if (signal.aborted) throw err
    throw new SearchFailedError('unavailable')
  }
  if (res.status === 401 || res.status === 403) throw new SearchFailedError('invalid_key')
  if (res.status === 429 || res.status === 432 || res.status === 433) {
    throw new SearchFailedError('rate_limited')
  }
  if (!res.ok) throw new SearchFailedError('unavailable')
  return res
}

/** Reads the body as UTF-8 text, at most `max` bytes; a larger body is `unavailable`. */
export async function readText(
  res: Response,
  signal: AbortSignal,
  max = SEARCH_MAX_BYTES,
): Promise<string> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel().catch(() => {})
    throw new SearchFailedError('unavailable')
  }
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let size = 0
  let out = ''
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        throw new SearchFailedError('unavailable')
      }
      out += decoder.decode(value, { stream: true })
    }
  } catch (err) {
    if (err instanceof SearchFailedError || signal.aborted) throw err
    throw new SearchFailedError('unavailable')
  }
  return out + decoder.decode()
}

/** Reads a capped JSON body; text that is not JSON is `unavailable`. */
export async function readJson(res: Response, signal: AbortSignal): Promise<unknown> {
  const text = await readText(res, signal)
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SearchFailedError('unavailable')
  }
}

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

/** Decodes the HTML entities search backends use: the common named ones and numeric ones. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED[body.toLowerCase()] ?? whole
  })
}

/** Plain text from a backend's marked-up title or snippet, capped at `max` characters. */
export function plain(text: string, max: number): string {
  const out = decodeEntities(text.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > max ? `${cut(out, max)}…` : out
}
