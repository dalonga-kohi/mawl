import { createHmac } from 'node:crypto'

/**
 * Proof for the desktop host that `/healthz` is answered by the server it started, not by another
 * process holding the port (D1.5a review #7). The host sends a fresh random nonce as `?n=`; the
 * answer carries `id` = HMAC-SHA256(key = the auth token, domain + nonce), base64url. Without the
 * token nobody can compute it, the value does not reveal the token, and a new nonce per probe
 * stops replays. `/healthz` stays unauthenticated. Mirrored in
 * `apps/desktop/src-tauri/host/src/health.rs`; a shared test vector pins both.
 */
export const HEALTH_IDENTITY_DOMAIN = 'mawl/healthz-identity/v1:'

/** What the host sends: base64url, 16-128 characters. Anything else gets no proof. */
export const HEALTH_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

export function identityProof(token: string, nonce: string): string {
  return createHmac('sha256', token).update(`${HEALTH_IDENTITY_DOMAIN}${nonce}`).digest('base64url')
}
