import { createHmac } from 'node:crypto'
import { checkHost, type HostPolicy } from './events/host.ts'

/**
 * Proof for the desktop host that `/healthz` is answered by the Mawl it means, not by another
 * process holding the port (D1.5a review #7) or by a look-alike origin relaying the probe to the
 * real server (D1.5b2b head review). The host sends a fresh random nonce as `?n=` and the origin it
 * used as `?o=`; the answer carries `id` = HMAC-SHA256(key = the auth token, domain + nonce +
 * origin), base64url. Without the token nobody can compute it, the value does not reveal the token,
 * a new nonce per probe stops replays, and the origin in the MAC means a proof obtained for one
 * origin fails a check made for another. The server proves only origins it counts as its own
 * ({@link proofOrigin}). `/healthz` stays unauthenticated. Mirrored in
 * `apps/desktop/src-tauri/host/src/health.rs`; shared test vectors pin both.
 */
export const HEALTH_IDENTITY_DOMAIN = 'mawl/healthz-identity/v2:'

/** What the host sends: base64url, 16-128 characters. Anything else gets no proof. */
export const HEALTH_NONCE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/** Unit wiring without a HostPolicy: only loopback counts as this server's own. */
const LOOPBACK_ONLY: HostPolicy = { bindHost: '127.0.0.1', allowedOrigins: [] }

/**
 * The nonce is base64url (no `:`) and the origin starts with `http://` or `https://`, so
 * `nonce + origin` splits one way only and needs no separator.
 */
export function identityProof(token: string, nonce: string, origin: string): string {
  return createHmac('sha256', token)
    .update(`${HEALTH_IDENTITY_DOMAIN}${nonce}${origin}`)
    .digest('base64url')
}

/** `o` when it is an `http(s)` origin in canonical form (`new URL(o).origin === o`), else undefined. */
function canonicalOrigin(o: string | undefined): URL | undefined {
  if (!o) return undefined
  try {
    const url = new URL(o)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
    return url.origin === o ? url : undefined
  } catch {
    return undefined
  }
}

export type ProofDecision =
  /** No proof asked for, or a malformed request: the plain answer. */
  | { kind: 'plain' }
  /** A proof asked for on a Host, or for an origin, that is not this server's: 403, no proof. */
  | { kind: 'refuse' }
  | { kind: 'prove'; nonce: string; origin: string }

/**
 * Whether `/healthz` answers with a proof. The request's Host must pass the HostPolicy (the same
 * DNS rebinding guard as `/rpc`), and the origin to prove must be one of this server's own: a
 * loopback name, the bind address or a host of `MAWL_ALLOWED_ORIGINS` (scheme and port are the
 * client's, as for the Host check). The Host does not have to equal the origin, because a reverse
 * proxy may rewrite it to the loopback upstream; what matters is that a relay on another origin can
 * only ever obtain proofs for origins the owner listed, never for its own.
 */
export function proofOrigin(
  query: { n?: string | undefined; o?: string | undefined },
  host: string | undefined,
  hosts: HostPolicy | undefined,
): ProofDecision {
  if (query.n === undefined) return { kind: 'plain' }
  const policy = hosts ?? LOOPBACK_ONLY
  if (!checkHost(host, policy).ok) return { kind: 'refuse' }
  const origin = canonicalOrigin(query.o)
  if (!HEALTH_NONCE_PATTERN.test(query.n) || !origin) return { kind: 'plain' }
  if (!checkHost(origin.host, policy).ok) return { kind: 'refuse' }
  return { kind: 'prove', nonce: query.n, origin: origin.origin }
}
