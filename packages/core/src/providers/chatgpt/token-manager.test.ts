import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import {
  ACCESS,
  ALL_SCOPES,
  CLIENT_ID,
  json,
  memoryStore,
  REFRESH,
  scriptedFetch,
  stored,
  tokenResponse,
} from './test-util.ts'
import { createTokenManager } from './token-manager.ts'

const NOW = 1_000_000
const MIN = 60_000

function setup(
  over: Parameters<typeof stored>[0] = {},
  script: Parameters<typeof scriptedFetch>[0] = [
    tokenResponse({ access_token: 'new-access', refresh_token: 'new-refresh' }),
  ],
  id = 'cred_1',
) {
  const store = memoryStore(stored({ expiresAt: NOW + 30 * MIN, ...over }))
  const net = scriptedFetch(script)
  const tokens = createTokenManager({ credentialId: id, store, fetch: net.fetch, now: () => NOW })
  return { store, net, tokens }
}

describe('token manager refresh timing', () => {
  it('returns the stored access token without a request while more than 5 minutes remain', async () => {
    const { tokens, net } = setup({ expiresAt: NOW + 5 * MIN + 1 })
    expect(await tokens.getAccessToken()).toBe(ACCESS)
    expect(net.calls).toHaveLength(0)
  })

  it('refreshes when less than 5 minutes remain', async () => {
    const { tokens, net } = setup({ expiresAt: NOW + 5 * MIN - 1 })
    expect(await tokens.getAccessToken()).toBe('new-access')
    expect(net.calls).toHaveLength(1)
  })

  it('refreshes an expired or token-less credential that still has a refresh token', async () => {
    const { tokens } = setup({ expiresAt: NOW - 1, accessToken: null })
    expect(await tokens.getAccessToken()).toBe('new-access')
  })
})

describe('token manager rotation', () => {
  it('persists the rotated refresh token before handing out the new access token', async () => {
    const { tokens, store } = setup({ expiresAt: NOW })
    const order: string[] = []
    const original = store.save.bind(store)
    store.save = async (next) => {
      await original(next)
      order.push('saved')
    }
    const token = await tokens.getAccessToken()
    order.push('returned')
    expect(token).toBe('new-access')
    expect(order).toEqual(['saved', 'returned'])
    expect(store.current).toMatchObject({
      clientId: CLIENT_ID,
      accessToken: 'new-access',
      refreshToken: 'new-refresh',
      expiresAt: NOW + 3600 * 1000,
      scope: ALL_SCOPES,
    })
  })

  it('keeps the old refresh token and id token when the response omits them', async () => {
    const { tokens, store } = setup({ expiresAt: NOW, idToken: 'old-id' }, [
      json({ access_token: 'a2', token_type: 'Bearer', expires_in: 600 }),
    ])
    await tokens.getAccessToken()
    expect(store.current).toMatchObject({
      refreshToken: REFRESH,
      idToken: 'old-id',
      scope: ALL_SCOPES,
    })
  })

  it('runs exactly one refresh for concurrent callers', async () => {
    const { tokens, net } = setup({ expiresAt: NOW })
    const results = await Promise.all([
      tokens.getAccessToken(),
      tokens.getAccessToken(),
      tokens.getAccessToken(),
    ])
    expect(results).toEqual(['new-access', 'new-access', 'new-access'])
    expect(net.calls).toHaveLength(1)
  })

  it('serialises refreshes per credential id across manager instances', async () => {
    const store = memoryStore(stored({ expiresAt: NOW }))
    const net = scriptedFetch([tokenResponse({ access_token: 'shared', refresh_token: 'r2' })])
    const make = () =>
      createTokenManager({ credentialId: 'cred_shared', store, fetch: net.fetch, now: () => NOW })
    const a = make()
    const b = make()
    expect(await Promise.all([a.getAccessToken(), b.getAccessToken()])).toEqual([
      'shared',
      'shared',
    ])
    expect(net.calls).toHaveLength(1)
  })

  it('does not block refreshes of different credentials', async () => {
    const a = setup({ expiresAt: NOW }, undefined, 'cred_a')
    const b = setup({ expiresAt: NOW }, undefined, 'cred_b')
    await Promise.all([a.tokens.getAccessToken(), b.tokens.getAccessToken()])
    expect(a.net.calls).toHaveLength(1)
    expect(b.net.calls).toHaveLength(1)
  })

  it('refreshAfterRejection refreshes once, but reuses a token another caller already rotated', async () => {
    const { tokens, net, store } = setup({ expiresAt: NOW + 30 * MIN })
    expect(await tokens.refreshAfterRejection(ACCESS)).toBe('new-access')
    // A second caller that was rejected with the same old token must not rotate again.
    expect(await tokens.refreshAfterRejection(ACCESS)).toBe('new-access')
    expect(net.calls).toHaveLength(1)
    expect(store.current.refreshToken).toBe('new-refresh')
  })
})

describe('token manager failures', () => {
  it.each([
    'invalid_grant',
    'invalid_refresh_token',
    'token_expired',
    'refresh_token_expired',
    'refresh_token_invalidated',
    'refresh_token_reused',
  ])('clears the tokens, keeps the client id and needs re-auth on %s', async (error) => {
    const { tokens, store } = setup({ expiresAt: NOW }, [json({ error }, 400)])
    const err = await tokens.getAccessToken().catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect((err as ProviderFailureError).reason).toBe('reauth_required')
    expect(store.log).toEqual(['clear'])
    expect(store.current).toMatchObject({
      clientId: CLIENT_ID,
      accessToken: null,
      refreshToken: null,
      idToken: null,
    })
  })

  it('answers reauth_required without any request once tokens are cleared', async () => {
    const { tokens, net } = setup({
      accessToken: null,
      refreshToken: null,
      idToken: null,
      expiresAt: 0,
    })
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ reason: 'reauth_required' })
    expect(net.calls).toHaveLength(0)
  })

  it('reports invalid_client as a config error and keeps the tokens', async () => {
    const { tokens, store } = setup({ expiresAt: NOW }, [json({ error: 'invalid_client' }, 401)])
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ reason: 'config_error' })
    expect(store.log).toEqual([])
    expect(store.current.refreshToken).toBe(REFRESH)
  })

  it('treats a 5xx refresh as temporary and never erases credentials for it', async () => {
    const { tokens, store } = setup({ expiresAt: NOW }, [new Response('', { status: 503 })])
    await expect(tokens.getAccessToken()).rejects.toMatchObject({
      reason: 'temporarily_unavailable',
    })
    expect(store.log).toEqual([])
  })

  it('refuses inference when the grant lacks chatgpt.tokens.use.direct, without a request', async () => {
    const { tokens, net } = setup({ scope: 'openid profile email offline_access' })
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ reason: 'plan_usage_disabled' })
    expect(net.calls).toHaveLength(0)
  })

  it('stores a refreshed scope and then refuses when the new grant lost plan usage', async () => {
    const { tokens, store } = setup({ expiresAt: NOW }, [tokenResponse({ scope: 'openid email' })])
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ reason: 'plan_usage_disabled' })
    expect(store.current.scope).toBe('openid email')
  })
})
