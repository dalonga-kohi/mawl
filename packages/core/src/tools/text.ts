import type { Json } from '@mawl/contracts'

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff

/**
 * Cuts `text` to at most `max` UTF-16 units without splitting a surrogate pair: if the cut would
 * leave a lone high surrogate at the end, it drops that half too.
 */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text
  const end = max > 0 && isHigh(text.charCodeAt(max - 1)) ? max - 1 : max
  return text.slice(0, end)
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

/**
 * Makes untrusted text storable: Postgres rejects NUL (U+0000) in text and jsonb, and jsonb
 * rejects an unpaired surrogate escape. NULs are removed and lone surrogates become U+FFFD, so a
 * hostile page is data that can be stored, never an error that makes the job retry forever.
 */
export function storable(text: string): string {
  return text.replaceAll('\u0000', '').replace(LONE_SURROGATE, '�')
}

/** `storable` applied to every string (keys included) of a JSON value. */
export function storableJson(value: Json): Json {
  if (typeof value === 'string') return storable(value)
  if (Array.isArray(value)) return value.map(storableJson)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [storable(k), storableJson(v)]))
  }
  return value
}
