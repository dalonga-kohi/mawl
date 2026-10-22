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

const WHITESPACE = /\s/

/**
 * Replaces the password in `scheme://user:password@host` with a censor. Anchored on "://" (found
 * with indexOf, so cost is linear) and takes userinfo up to the LAST "@" before the next
 * whitespace, because a password may itself contain "/", ":" or "@".
 */
function scrubUrlPasswords(value: string): string {
  let from = value.indexOf('://')
  if (from === -1) return value
  let out = ''
  let cursor = 0
  while (from !== -1) {
    const start = from + 3
    let end = start
    while (end < value.length && !WHITESPACE.test(value[end] as string)) end++
    const at = value.lastIndexOf('@', end - 1)
    if (at >= start) {
      const colon = value.indexOf(':', start)
      if (colon !== -1 && colon < at) {
        out += `${value.slice(cursor, colon + 1)}${CENSOR}`
        cursor = at
      }
    }
    from = value.indexOf('://', end)
  }
  return out + value.slice(cursor)
}

/** Shorter values would censor ordinary text and say too little about the secret. */
const MIN_SECRET_VALUE_LENGTH = 16
const SECRET_VALUE_CHARSET = /^[A-Za-z0-9._~+/=-]+$/
const secretValues = new Set<string>()

/**
 * Censors `value` wherever it appears, in redactDeep output and in every logger line (keys and
 * messages included), for the rest of the process. For values with no recognisable key or shape,
 * such as the desktop launch token. Process-wide on purpose: a secret must not leak through a
 * logger or redactor that was created before it was known.
 */
export function registerSecretValue(value: string): void {
  if (value.length < MIN_SECRET_VALUE_LENGTH) {
    throw new Error(`a secret value must be at least ${MIN_SECRET_VALUE_LENGTH} characters`)
  }
  // Characters JSON never escapes, so the value reads the same in a serialized log line.
  if (!SECRET_VALUE_CHARSET.test(value)) {
    throw new Error('a secret value must use only A-Z a-z 0-9 . _ ~ + / = -')
  }
  secretValues.add(value)
}

/** Tests only. */
export function __resetSecretValues(): void {
  secretValues.clear()
}

/** Replaces every registered secret value in `value`. Cheap when none is registered. */
export function scrubSecretValues(value: string): string {
  let out = value
  for (const secret of secretValues) {
    if (out.includes(secret)) out = out.replaceAll(secret, CENSOR)
  }
  return out
}

/** Value patterns: registered secrets, url userinfo, bearer tokens, well-known key prefixes. */
function scrubString(value: string): string {
  return scrubUrlPasswords(scrubSecretValues(value))
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
