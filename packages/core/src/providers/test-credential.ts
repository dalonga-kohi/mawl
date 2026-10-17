import type { ProviderTestResult } from '@faire/contracts'
import { type ProviderConnection, resolveBaseUrl } from './descriptors.ts'

export interface TestCredentialOptions {
  fetch?: typeof globalThis.fetch
  /** Deadline for the whole request. Defaults to 10 s. */
  timeoutMs?: number
  /** Monotonic clock in ms. Defaults to `performance.now`. */
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 10_000

/** One cheap, free GET per provider: a key check must never spend tokens. */
function request(conn: ProviderConnection): { url: string; headers: Record<string, string> } {
  const base = resolveBaseUrl(conn.kind, conn.baseUrl)
  const bearer = conn.secret ? { authorization: `Bearer ${conn.secret}` } : {}
  switch (conn.kind) {
    case 'anthropic':
      return {
        url: `${base}/models`,
        headers: { 'x-api-key': conn.secret ?? '', 'anthropic-version': '2023-06-01' },
      }
    case 'openai':
    case 'openai_compatible':
      return { url: `${base}/models`, headers: bearer }
    case 'openrouter':
      return { url: `${base}/key`, headers: bearer }
    case 'ollama':
      return { url: `${base}/api/tags`, headers: bearer }
  }
}

/**
 * Checks that a credential works. The result is a closed set of outcomes: the provider's
 * response body is never read and no error text is passed on, because either can echo the key.
 * Redirects are refused so a key is never forwarded to another host.
 */
export async function testCredential(
  conn: ProviderConnection,
  {
    fetch = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => performance.now(),
  }: TestCredentialOptions = {},
): Promise<ProviderTestResult> {
  let target: ReturnType<typeof request>
  try {
    target = request(conn)
    new URL(target.url)
  } catch {
    return { ok: false, reason: 'unreachable' }
  }

  const started = now()
  let res: Response
  try {
    res = await fetch(target.url, {
      method: 'GET',
      headers: target.headers,
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, reason: 'unreachable' }
  }
  const latencyMs = Math.max(0, Math.round(now() - started))
  // Free the connection without reading anything.
  void res.body?.cancel().catch(() => {})

  if (res.status >= 200 && res.status < 300) return { ok: true, latencyMs }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid_key' }
  if (res.status === 429) return { ok: false, reason: 'rate_limited' }
  return { ok: false, reason: 'unexpected_response' }
}
