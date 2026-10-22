import { createHash, timingSafeEqual } from 'node:crypto'
import { AUTH_TOKEN_PATTERN, AUTH_WS_PROTOCOL, AUTH_WS_TOKEN_PREFIX } from '@mawl/contracts'

export { AUTH_WS_PROTOCOL as WS_PROTOCOL, AUTH_WS_TOKEN_PREFIX as WS_TOKEN_PREFIX }

/** The launch and owner token format: base64url, 32-512 characters. */
export function isAuthToken(value: string): boolean {
  return AUTH_TOKEN_PATTERN.test(value)
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

/**
 * Constant-time comparison. Both sides are hashed first, so the compared buffers always have the
 * same length and neither the token's length nor the position of the first difference leaks.
 */
export function tokenMatches(presented: string | undefined, expected: string): boolean {
  if (presented === undefined) {
    // Same work as a real comparison, so a missing token is not faster to reject.
    timingSafeEqual(digest(''), digest(expected))
    return false
  }
  return timingSafeEqual(digest(presented), digest(expected))
}

/** The token of an `Authorization: Bearer <token>` header; undefined for anything else. */
export function bearerToken(header: string | undefined): string | undefined {
  const match = /^bearer ([^\s]+)$/i.exec(header ?? '')
  return match?.[1]
}

/**
 * The token offered as the `mawl.token.<token>` subprotocol of a WebSocket handshake. Only valid
 * next to `mawl.v1` (the protocol the server echoes back) and only when offered exactly once.
 */
export function protocolToken(header: string | undefined): string | undefined {
  if (!header) return undefined
  const offered = header
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  if (!offered.includes(AUTH_WS_PROTOCOL)) return undefined
  const tokens = offered.filter((p) => p.startsWith(AUTH_WS_TOKEN_PREFIX))
  if (tokens.length !== 1) return undefined
  const token = (tokens[0] as string).slice(AUTH_WS_TOKEN_PREFIX.length)
  return token === '' ? undefined : token
}
