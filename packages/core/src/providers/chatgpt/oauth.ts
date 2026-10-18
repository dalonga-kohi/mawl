import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { RESOURCE, REVOKE_URL, TOKEN_URL } from './constants.ts'
import { extractErrorCode } from './errors.ts'

/**
 * A token or revocation request failed. `code` is the OAuth error code, or `unavailable`
 * (network, timeout, 5xx, 429), `bad_response` (success body is malformed), or `unknown`.
 * Carries no provider text: bodies can echo tokens.
 */
export class OAuthTokenError extends Error {
  constructor(
    readonly code: string,
    readonly status?: number,
  ) {
    super(`OAuth token request failed: ${code}`)
    this.name = 'OAuthTokenError'
  }
}

export interface TokenGrant {
  accessToken: string
  refreshToken: string | null
  idToken: string | null
  /** Seconds. */
  expiresIn: number
  scope: string | null
}

const TIMEOUT_MS = 15_000

const GrantBody = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  id_token: z.string().min(1).optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
})

type Fetch = typeof globalThis.fetch

/** One form POST. Redirects are refused so tokens never reach another host. */
async function postForm(
  fetch: Fetch,
  url: string,
  params: Record<string, string>,
): Promise<Response> {
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new OAuthTokenError('unavailable')
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return JSON.parse(await res.text())
  } catch {
    return undefined
  }
}

async function toGrant(res: Response): Promise<TokenGrant> {
  if (res.status >= 500 || res.status === 429) {
    void res.body?.cancel().catch(() => {})
    throw new OAuthTokenError('unavailable', res.status)
  }
  const body = await readJson(res)
  if (!res.ok) throw new OAuthTokenError(extractErrorCode(body) ?? 'unknown', res.status)
  const parsed = GrantBody.safeParse(body)
  if (!parsed.success) throw new OAuthTokenError('bad_response', res.status)
  const g = parsed.data
  return {
    accessToken: g.access_token,
    refreshToken: g.refresh_token ?? null,
    idToken: g.id_token ?? null,
    expiresIn: g.expires_in,
    scope: g.scope ?? null,
  }
}

export interface ExchangeParams {
  fetch: Fetch
  /** The issued `oaiapp_...` id. */
  clientId: string
  code: string
  verifier: string
  /** Identical to the one in the authorize request. */
  redirectUri: string
}

export async function exchangeCode(p: ExchangeParams): Promise<TokenGrant> {
  const res = await postForm(p.fetch, TOKEN_URL, {
    grant_type: 'authorization_code',
    client_id: p.clientId,
    code: p.code,
    code_verifier: p.verifier,
    redirect_uri: p.redirectUri,
    resource: RESOURCE,
  })
  return toGrant(res)
}

export interface RefreshParams {
  fetch: Fetch
  clientId: string
  refreshToken: string
}

/** `scope` is omitted on purpose: that retains the existing grant. */
export async function refreshGrant(p: RefreshParams): Promise<TokenGrant> {
  const res = await postForm(p.fetch, TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: p.clientId,
    refresh_token: p.refreshToken,
    resource: RESOURCE,
  })
  return toGrant(res)
}

export type RevokeOutcome = 'revoked' | 'retry' | 'failed'

/** An empty 200 is success. Network errors and 5xx may be retried; anything else will not improve. */
export async function revokeRefreshToken(p: RefreshParams): Promise<RevokeOutcome> {
  let res: Response
  try {
    res = await postForm(p.fetch, REVOKE_URL, {
      token: p.refreshToken,
      token_type_hint: 'refresh_token',
      client_id: p.clientId,
    })
  } catch {
    return 'retry'
  }
  void res.body?.cancel().catch(() => {})
  if (res.ok) return 'revoked'
  return res.status >= 500 ? 'retry' : 'failed'
}

export interface RevokeRetryParams extends RefreshParams {
  /** Injected in tests. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>
  maxAttempts?: number
  baseDelayMs?: number
}

/** Bounded retry with doubling backoff. Resolves true only when revocation was confirmed. */
export async function revokeWithRetry({
  sleep = (ms) => delay(ms),
  maxAttempts = 3,
  baseDelayMs = 500,
  ...p
}: RevokeRetryParams): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const outcome = await revokeRefreshToken(p)
    if (outcome === 'revoked') return true
    if (outcome === 'failed') return false
    if (attempt < maxAttempts - 1) await sleep(baseDelayMs * 2 ** attempt)
  }
  return false
}
