import { z } from 'zod'
import { OPENAI_ISSUER } from './constants.ts'

/** The ID token failed a check. The message names the check, never token content. */
export class IdTokenError extends Error {
  constructor(readonly check: 'format' | 'issuer' | 'audience' | 'expiry' | 'nonce' | 'subject') {
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

export interface IdTokenChecks {
  /** The issued client id; must be in `aud`. */
  clientId: string
  nonce: string
  /** Epoch ms. */
  now: number
}

/**
 * Checks iss, aud, exp and nonce. The signature is not checked: the token comes straight from
 * the token endpoint over TLS (OIDC Core 3.1.3.7), never from the browser.
 */
export function verifyIdToken(
  idToken: string,
  { clientId, nonce, now }: IdTokenChecks,
): { subject: string; email: string | null } {
  const part = idToken.split('.')[1]
  if (idToken.split('.').length !== 3 || !part) throw new IdTokenError('format')
  let raw: unknown
  try {
    raw = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
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
