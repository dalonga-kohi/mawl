import { AUTH_TOKEN_PATTERN } from '@mawl/contracts'

/**
 * Where the web app gets the token the server requires on `/rpc` and `/ws` (D1.4):
 * - Desktop: the Tauri host injects the per-launch token as `window.__MAWL_LAUNCH_TOKEN__`
 *   through an initialization script (D1.5).
 * - Headless (a browser on the server's page): the owner types the owner token once per tab; it
 *   stays in sessionStorage, so it is gone when the tab closes and never sits in localStorage.
 */
export const OWNER_TOKEN_KEY = 'mawl.ownerToken'

const isToken = (value: unknown): value is string =>
  typeof value === 'string' && AUTH_TOKEN_PATTERN.test(value)

export function launchToken(win: Window): string | undefined {
  const value = (win as { __MAWL_LAUNCH_TOKEN__?: unknown }).__MAWL_LAUNCH_TOKEN__
  return isToken(value) ? value : undefined
}

export function readStoredToken(storage: Storage | null): string | undefined {
  try {
    const value = storage?.getItem(OWNER_TOKEN_KEY)
    return isToken(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function storeToken(storage: Storage | null, token: string): void {
  try {
    storage?.setItem(OWNER_TOKEN_KEY, token)
  } catch {
    // Private mode or a full quota: the token then lasts for this page only.
  }
}

export function clearStoredToken(storage: Storage | null): void {
  try {
    storage?.removeItem(OWNER_TOKEN_KEY)
  } catch {
    // Nothing stored that we could reach.
  }
}

export function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export type TokenCheck = 'ok' | 'unauthorized' | 'unreachable'

/**
 * Asks the server whether `token` opens it: `health.get` over HTTP `/rpc` with the Bearer header
 * (a refused WebSocket upgrade does not tell a browser why, a 401 does).
 */
export async function verifyToken(
  token: string,
  { origin, fetch = globalThis.fetch }: { origin: string; fetch?: typeof globalThis.fetch },
): Promise<TokenCheck> {
  if (!isToken(token)) return 'unauthorized'
  try {
    const res = await fetch(`${origin}/rpc/health/get`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: '{}',
      cache: 'no-store',
    })
    if (res.status === 401) return 'unauthorized'
    return res.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}
