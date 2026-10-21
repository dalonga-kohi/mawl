export type OriginCheck =
  | { ok: true }
  | { ok: false; reason: 'origin_malformed' | 'origin_not_allowed' }

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Lowercase, no trailing slash: how origins in `MAWL_ALLOWED_ORIGINS` and headers are compared. */
export function normalizeOrigin(value: string): string {
  return value.trim().toLowerCase().replace(/\/+$/, '')
}

/**
 * Cross-site WebSocket hijacking guard: a browser always sends `Origin` on a WebSocket
 * handshake, and a page on another site must not be able to talk to a server on the owner's
 * network. A missing Origin means a non-browser client and passes (device auth is P6.1).
 * Allowed: the same host as the request, loopback on any port, the Tauri webview, and the
 * origins the owner lists in `MAWL_ALLOWED_ORIGINS`.
 */
export function checkOrigin(input: {
  origin: string | undefined
  host: string | undefined
  allowed: readonly string[]
}): OriginCheck {
  const { origin, host } = input
  if (origin === undefined) return { ok: true }
  const normalized = normalizeOrigin(origin)
  if (input.allowed.some((a) => normalizeOrigin(a) === normalized)) return { ok: true }
  if (normalized === 'tauri://localhost') return { ok: true }
  // The opaque origin of sandboxed pages and data: urls.
  if (normalized === 'null') return { ok: false, reason: 'origin_not_allowed' }

  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return { ok: false, reason: 'origin_malformed' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'origin_not_allowed' }
  }
  if (host !== undefined && url.host.toLowerCase() === host.toLowerCase()) return { ok: true }
  if (LOOPBACK_HOSTNAMES.has(url.hostname)) return { ok: true }
  if (url.host === 'tauri.localhost') return { ok: true }
  return { ok: false, reason: 'origin_not_allowed' }
}
