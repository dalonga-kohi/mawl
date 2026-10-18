import { compactVerify, createRemoteJWKSet, type JWTVerifyGetKey } from 'jose'
import { z } from 'zod'
import { JWKS_URL, OPENAI_ISSUER } from './constants.ts'

/** The ID token failed a check. The message names the check, never token content. */
export class IdTokenError extends Error {
  constructor(
    readonly check: 'format' | 'signature' | 'issuer' | 'audience' | 'expiry' | 'nonce' | 'subject',
  ) {
    super(`ID token rejected: ${check}`)
    this.name = 'IdTokenError'
  }
}

const Claims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  nonce: z.string().optional(),
  sub: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
})

/** Resolves the key that signed a token (jose's key-resolver shape). */
export type IdTokenKeys = JWTVerifyGetKey

export interface IdTokenChecks {
  /** The issued client id; must be in `aud`. */
  clientId: string
  nonce: string
  /** Epoch ms. */
  now: number
  /** The issuer's signing keys. Defaults to OpenAI's published JWKS; tests inject a local set. */
  keys?: IdTokenKeys
}

let remoteKeys: IdTokenKeys | undefined
/** OpenAI's JWKS, fetched lazily with a short timeout and cached by jose. */
function defaultKeys(): IdTokenKeys {
  remoteKeys ??= createRemoteJWKSet(new URL(JWKS_URL), { timeoutDuration: 5000 })
  return remoteKeys
}

/**
 * Verifies the RS256 signature against the issuer's JWKS (OpenAI's documented requirement),
 * then checks iss, aud, exp and nonce. A key set that cannot be fetched fails closed as
 * `signature`.
 */
export async function verifyIdToken(
  idToken: string,
  { clientId, nonce, now, keys = defaultKeys() }: IdTokenChecks,
): Promise<{ subject: string; email: string | null }> {
  if (idToken.split('.').length !== 3) throw new IdTokenError('format')
  let payload: Uint8Array
  try {
    ;({ payload } = await compactVerify(idToken, keys, { algorithms: ['RS256'] }))
  } catch {
    throw new IdTokenError('signature')
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder().decode(payload))
  } catch {
    throw new IdTokenError('format')
  }
  const parsed = Claims.safeParse(raw)
  if (!parsed.success) throw new IdTokenError('format')
  const c = parsed.data
  if (c.iss !== OPENAI_ISSUER) throw new IdTokenError('issuer')
  if (!(Array.isArray(c.aud) ? c.aud : [c.aud]).includes(clientId)) {
    throw new IdTokenError('audience')
  }
  if (c.exp * 1000 <= now) throw new IdTokenError('expiry')
  if (c.nonce !== nonce) throw new IdTokenError('nonce')
  if (!c.sub) throw new IdTokenError('subject')
  return { subject: c.sub, email: c.email ?? null }
}
