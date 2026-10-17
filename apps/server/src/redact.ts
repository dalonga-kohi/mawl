/**
 * Key fragments (lower-case, with `-` and `_` removed) that mark a value as sensitive. A key is
 * redacted when its normalised form contains any of them, so `accessToken`, `x-api-key`,
 * `set-cookie` and `clientSecret` are all caught.
 */
export const REDACT_KEY_PARTS: readonly string[] = [
  'token',
  'secret',
  'password',
  'passwd',
  'apikey',
  'privatekey',
  'cookie',
  'authorization',
  'connectionstring',
  'dsn',
  'databaseurl',
]

/** Normalised keys that contain a fragment above but are harmless counters. */
export const REDACT_KEY_ALLOW: ReadonlySet<string> = new Set([
  'tokencount',
  'inputtokens',
  'outputtokens',
  'cachedtokens',
  'reasoningtokens',
  'totaltokens',
  'maxtokens',
])

const CENSOR = '[Redacted]'
const MAX_DEPTH = 10

const normaliseKey = (key: string) => key.toLowerCase().replace(/[-_]/g, '')

function isSensitiveKey(key: string): boolean {
  const k = normaliseKey(key)
  if (REDACT_KEY_ALLOW.has(k)) return false
  return REDACT_KEY_PARTS.some((part) => k.includes(part))
}

/** Value patterns: url userinfo, bearer tokens, and well-known provider key prefixes. */
function scrubString(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*):[^\s@/]*@/gi, `$1:${CENSOR}@`)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${CENSOR}`)
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, CENSOR)
}

function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value)
  if (typeof value !== 'object' || value === null) return value
  if (ancestors.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[Truncated]'
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, ancestors))
    const source: Record<string, unknown> =
      value instanceof Error
        ? { ...value, type: value.name, message: value.message, stack: value.stack }
        : (value as Record<string, unknown>)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      out[key] = isSensitiveKey(key) ? CENSOR : walk(item, depth + 1, ancestors)
    }
    return out
  } finally {
    // Only ancestors count as cycles: a shared sibling reference is walked again.
    ancestors.delete(value)
  }
}

/**
 * Returns a copy of `value` with sensitive keys censored and credentials scrubbed from every
 * string, at any depth. Never mutates.
 */
export function redactDeep(value: unknown): unknown {
  return walk(value, 0, new WeakSet())
}
