/**
 * How a client proves it may talk to the server (D1.4): the per-launch token in desktop mode,
 * the owner token in headless mode. Over HTTP it travels as `Authorization: Bearer <token>`.
 * Browsers cannot set headers on a WebSocket, so on `/ws` it travels as a second subprotocol
 * next to `mawl.v1`; the server selects and echoes `mawl.v1` only, never the token. The token is
 * never put in a URL.
 */
export const AUTH_WS_PROTOCOL = 'mawl.v1'
export const AUTH_WS_TOKEN_PREFIX = 'mawl.token.'

/** Base64url, 32-512 characters: the launch token's format, shared by the owner token. */
export const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/

/** The subprotocols a client offers on `/ws`. Throws (without echoing it) on a malformed token. */
export function wsProtocols(token: string): [string, string] {
  if (!AUTH_TOKEN_PATTERN.test(token)) {
    throw new Error('auth token must be 32-512 base64url characters')
  }
  return [AUTH_WS_PROTOCOL, `${AUTH_WS_TOKEN_PREFIX}${token}`]
}
