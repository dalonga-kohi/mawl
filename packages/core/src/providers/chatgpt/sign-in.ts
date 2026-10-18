import { timingSafeEqual } from 'node:crypto'
import type { ChatGptSignInFailure } from '@faire/contracts'
import { buildAuthorizeUrl, redirectUri } from './authorize.ts'
import { DYNAMIC_CLIENT_ID } from './constants.ts'
import { IdTokenError, type IdTokenKeys, verifyIdToken } from './id-token.ts'
import { exchangeCode, OAuthTokenError } from './oauth.ts'
import { createPkce, type RandomBytes, systemRandom } from './pkce.ts'
import { hasPlanUsage, type StoredChatGptCredential } from './stored.ts'

/** Everything one browser sign-in needs to remember until the callback arrives. Keep it in memory only. */
export interface SignInAttempt {
  state: string
  nonce: string
  verifier: string
  redirectUri: string
  /** The saved issued client id, or null on first registration. */
  clientId: string | null
  authorizeUrl: string
}

export interface BeginSignInOptions {
  clientId: string | null
  hostId: string
  port: number
  random?: RandomBytes
}

export function beginSignIn({
  clientId,
  hostId,
  port,
  random = systemRandom,
}: BeginSignInOptions): SignInAttempt {
  const { verifier, challenge } = createPkce(random)
  const state = Buffer.from(random(24)).toString('base64url')
  const nonce = Buffer.from(random(24)).toString('base64url')
  const redirect = redirectUri(port)
  return {
    state,
    nonce,
    verifier,
    redirectUri: redirect,
    clientId,
    authorizeUrl: buildAuthorizeUrl({
      clientId,
      hostId,
      redirectUri: redirect,
      state,
      nonce,
      challenge,
    }),
  }
}

export type SignInResult =
  | {
      ok: true
      clientId: string
      subject: string
      accountEmail: string | null
      /** False when the grant lacks chatgpt.tokens.use.direct: signed in, but no inference. */
      planUsage: boolean
      credential: StoredChatGptCredential
    }
  | { ok: false; reason: ChatGptSignInFailure }

export interface CompleteSignInDeps {
  fetch: typeof globalThis.fetch
  /** Epoch ms. */
  now: () => number
  /** Must be durable before it resolves: it runs before the code exchange. */
  saveClientId(clientId: string): Promise<void>
  /** Signing keys for the ID token; defaults to OpenAI's JWKS. */
  idTokenKeys?: IdTokenKeys
}

const fail = (reason: ChatGptSignInFailure): SignInResult => ({ ok: false, reason })

function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Constant-time check that a callback carries this attempt's state. */
export function stateMatches(attempt: SignInAttempt, params: URLSearchParams): boolean {
  const state = params.get('state')
  return state !== null && sameSecret(state, attempt.state)
}

/** Finishes a sign-in from the callback's query parameters. Never returns provider text. */
export async function completeSignIn(
  attempt: SignInAttempt,
  params: URLSearchParams,
  { fetch, now, saveClientId, idTokenKeys }: CompleteSignInDeps,
): Promise<SignInResult> {
  const state = params.get('state')
  if (state === null || !sameSecret(state, attempt.state)) return fail('state_mismatch')
  const oauthError = params.get('error')
  if (oauthError !== null)
    return fail(oauthError === 'access_denied' ? 'access_denied' : 'oauth_error')
  const code = params.get('code')
  if (!code) return fail('oauth_error')

  const supplied = params.get('client_id')
  let clientId: string
  if (attempt.clientId === null) {
    // New registration: OpenAI must have issued an id, and it is never the placeholder.
    if (!supplied || supplied === DYNAMIC_CLIENT_ID || !supplied.startsWith('oaiapp_')) {
      return fail('registration_incomplete')
    }
    clientId = supplied
    // Before the exchange, so a failed exchange still reuses this registration next time.
    await saveClientId(clientId)
  } else {
    if (supplied !== null && supplied !== attempt.clientId) return fail('client_mismatch')
    clientId = attempt.clientId
  }

  let grant: Awaited<ReturnType<typeof exchangeCode>>
  try {
    grant = await exchangeCode({
      fetch,
      clientId,
      code,
      verifier: attempt.verifier,
      redirectUri: attempt.redirectUri,
    })
  } catch (err) {
    if (err instanceof OAuthTokenError) return fail('exchange_failed')
    throw err
  }
  if (!grant.refreshToken) return fail('exchange_failed')
  if (!grant.idToken) return fail('invalid_id_token')

  let identity: Awaited<ReturnType<typeof verifyIdToken>>
  try {
    identity = await verifyIdToken(grant.idToken, {
      clientId,
      nonce: attempt.nonce,
      now: now(),
      ...(idTokenKeys ? { keys: idTokenKeys } : {}),
    })
  } catch (err) {
    if (err instanceof IdTokenError) return fail('invalid_id_token')
    throw err
  }

  const scope = grant.scope ?? ''
  return {
    ok: true,
    clientId,
    subject: identity.subject,
    accountEmail: identity.email,
    planUsage: hasPlanUsage(scope),
    credential: {
      clientId,
      accessToken: grant.accessToken,
      refreshToken: grant.refreshToken,
      idToken: grant.idToken,
      expiresAt: now() + grant.expiresIn * 1000,
      scope,
    },
  }
}
