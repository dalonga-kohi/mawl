/** Lower-cased object keys whose values are never logged. */
export const REDACT_KEYS: ReadonlySet<string> = new Set([
  'secret',
  'apikey',
  'api_key',
  'token',
  'password',
  'secretenc',
  'secret_enc',
  'authorization',
  'cookie',
  'databaseurl',
  'database_url',
])

const CENSOR = '[Redacted]'
const MAX_DEPTH = 10

function walk(value: unknown, depth: number, ancestors: WeakSet<object>): unknown {
  if (typeof value !== 'object' || value === null) return value
  if (ancestors.has(value)) return '[Circular]'
  if (depth >= MAX_DEPTH) return '[Truncated]'
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => walk(item, depth + 1, ancestors))
    const source: Record<string, unknown> =
      value instanceof Error
        ? { type: value.name, message: value.message, stack: value.stack, ...value }
        : (value as Record<string, unknown>)
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      out[key] = REDACT_KEYS.has(key.toLowerCase()) ? CENSOR : walk(item, depth + 1, ancestors)
    }
    return out
  } finally {
    // Only ancestors count as cycles: a shared sibling reference is walked again.
    ancestors.delete(value)
  }
}

/** Returns a copy of `value` with sensitive keys censored at any depth. Never mutates. */
export function redactDeep(value: unknown): unknown {
  return walk(value, 0, new WeakSet())
}
