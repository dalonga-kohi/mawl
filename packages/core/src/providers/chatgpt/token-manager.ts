import { ProviderFailureError } from '../failure.ts'
import { REFRESH_MARGIN_MS } from './constants.ts'
import { OAuthTokenError, refreshGrant } from './oauth.ts'
import { hasPlanUsage, type StoredChatGptCredential } from './stored.ts'

/** Persistence supplied by the server. `save` must be durable before it resolves. */
export interface TokenStore {
  load(): Promise<StoredChatGptCredential>
  save(next: StoredChatGptCredential): Promise<void>
  /**
   * Drops access, refresh and id tokens; keeps the client id. Only when the stored refresh token
   * is still ailedRefreshToken: a newer sign-in must not be wiped by a late failure.
   */
  clearTokens(failedRefreshToken: string): Promise<void>
}

export interface TokenManagerOptions {
  credentialId: string
  store: TokenStore
  fetch: typeof globalThis.fetch
  /** Epoch ms. */
  now: () => number
}

export interface TokenManager {
  /** A bearer valid for at least 5 more minutes, refreshing first when needed. */
  getAccessToken(): Promise<string>
  /**
   * Called after the API rejected `rejected` with 401. Refreshes once, unless another caller
   * already replaced that token, and returns the current access token.
   */
  refreshAfterRejection(rejected: string): Promise<string>
}

/** Refresh errors after which the refresh token can never work again. */
const TERMINAL = new Set([
  'invalid_grant',
  'invalid_refresh_token',
  'token_expired',
  'refresh_token_expired',
  'refresh_token_invalidated',
  'refresh_token_reused',
])

/** Per credential id, so every manager for one credential shares a single queue. */
const queues = new Map<string, Promise<unknown>>()

/**
 * Rotated credentials whose save failed. The old refresh token is already spent at OpenAI, so
 * this copy is the only valid one: it is used and re-saved first. A hard crash while an entry is
 * here loses the rotation, and the owner has to sign in again.
 */
const pending = new Map<string, StoredChatGptCredential>()
const SAVE_ATTEMPTS = 3

/** Runs job after every earlier job for this credential id (refreshes, sign-in writes). */
export function withCredentialLock<T>(key: string, job: () => Promise<T>): Promise<T> {
  return serialised(key, job)
}

/** Forgets an unsaved rotated credential, e.g. when the credential row is replaced or deleted. */
export function discardPendingCredential(key: string): void {
  pending.delete(key)
}

async function serialised<T>(key: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.then(job)
  const tail = run.then(
    () => {},
    () => {},
  )
  queues.set(key, tail)
  try {
    return await run
  } finally {
    if (queues.get(key) === tail) queues.delete(key)
  }
}

export function createTokenManager({
  credentialId,
  store,
  fetch,
  now,
}: TokenManagerOptions): TokenManager {
  /** The freshest credential: a rotated one still waiting to be saved wins over the store. */
  async function latest(): Promise<StoredChatGptCredential> {
    const waiting = pending.get(credentialId)
    if (!waiting) return store.load()
    if (await trySave(waiting)) pending.delete(credentialId)
    return waiting
  }

  async function trySave(next: StoredChatGptCredential, attempts = 1): Promise<boolean> {
    for (let i = 0; i < attempts; i++) {
      try {
        await store.save(next)
        return true
      } catch {
        // Retried now and again before the next use.
      }
    }
    return false
  }

  async function refresh(current: StoredChatGptCredential): Promise<string> {
    if (!current.refreshToken) throw new ProviderFailureError('reauth_required')
    let grant: Awaited<ReturnType<typeof refreshGrant>>
    try {
      grant = await refreshGrant({
        fetch,
        clientId: current.clientId,
        refreshToken: current.refreshToken,
      })
    } catch (err) {
      if (!(err instanceof OAuthTokenError)) throw err
      if (TERMINAL.has(err.code)) {
        pending.delete(credentialId)
        await store.clearTokens(current.refreshToken)
        throw new ProviderFailureError('reauth_required')
      }
      if (err.code === 'invalid_client') throw new ProviderFailureError('config_error')
      throw new ProviderFailureError(
        err.code === 'unavailable' ? 'temporarily_unavailable' : 'provider_error',
      )
    }
    const next: StoredChatGptCredential = {
      clientId: current.clientId,
      accessToken: grant.accessToken,
      // Refresh tokens rotate: the new one must be stored before the new access token is used.
      refreshToken: grant.refreshToken ?? current.refreshToken,
      idToken: grant.idToken ?? current.idToken,
      expiresAt: now() + grant.expiresIn * 1000,
      scope: grant.scope ?? current.scope,
    }
    pending.set(credentialId, next)
    if (await trySave(next, SAVE_ATTEMPTS)) pending.delete(credentialId)
    if (!hasPlanUsage(next.scope)) throw new ProviderFailureError('plan_usage_disabled')
    return grant.accessToken
  }

  return {
    getAccessToken() {
      return serialised(credentialId, async () => {
        const current = await latest()
        if (!current.refreshToken && !current.accessToken) {
          throw new ProviderFailureError('reauth_required')
        }
        if (!hasPlanUsage(current.scope)) throw new ProviderFailureError('plan_usage_disabled')
        if (current.accessToken && current.expiresAt - now() > REFRESH_MARGIN_MS) {
          return current.accessToken
        }
        return refresh(current)
      })
    },

    refreshAfterRejection(rejected) {
      return serialised(credentialId, async () => {
        const current = await latest()
        if (current.accessToken && current.accessToken !== rejected) return current.accessToken
        return refresh(current)
      })
    },
  }
}
