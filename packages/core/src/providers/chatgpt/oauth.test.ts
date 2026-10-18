import { describe, expect, it } from 'vitest'
import {
  exchangeCode,
  OAuthTokenError,
  refreshGrant,
  revokeRefreshToken,
  revokeWithRetry,
} from './oauth.ts'
import { ACCESS, CLIENT_ID, json, REFRESH, scriptedFetch, tokenResponse } from './test-util.ts'

const form = (body: string) => Object.fromEntries(new URLSearchParams(body))

describe('exchangeCode', () => {
  it('posts a form with the code, verifier, redirect and resource, and no secret or scope', async () => {
    const { fetch, calls } = scriptedFetch([tokenResponse()])
    const grant = await exchangeCode({
      fetch,
      clientId: CLIENT_ID,
      code: 'the-code',
      verifier: 'the-verifier',
      redirectUri: 'http://127.0.0.1:1455/auth/callback',
    })
    expect(calls).toHaveLength(1)
    const call = calls[0]
    expect(call?.url).toBe('https://auth.openai.com/api/accounts/oauth/token')
    expect(call?.method).toBe('POST')
    expect(call?.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(call?.redirect).toBe('error')
    expect(form(call?.body ?? '')).toEqual({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code: 'the-code',
      code_verifier: 'the-verifier',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      resource: 'https://api.openai.com/v1',
    })
    expect(grant).toMatchObject({ accessToken: ACCESS, refreshToken: REFRESH, expiresIn: 3600 })
  })

  it('reports an OAuth error code from the body', async () => {
    const { fetch } = scriptedFetch([json({ error: 'invalid_grant', error_description: 'x' }, 400)])
    await expect(
      exchangeCode({ fetch, clientId: CLIENT_ID, code: 'c', verifier: 'v', redirectUri: 'r' }),
    ).rejects.toMatchObject({ name: 'OAuthTokenError', code: 'invalid_grant', status: 400 })
  })
})

describe('refreshGrant', () => {
  it('posts grant_type=refresh_token with the saved client id and resource, omitting scope', async () => {
    const { fetch, calls } = scriptedFetch([tokenResponse({ refresh_token: 'rotated' })])
    const grant = await refreshGrant({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH })
    expect(form(calls[0]?.body ?? '')).toEqual({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: REFRESH,
      resource: 'https://api.openai.com/v1',
    })
    expect(grant.refreshToken).toBe('rotated')
  })

  it('maps 5xx and network failures to "unavailable" and keeps nothing from the body', async () => {
    const down = scriptedFetch([new Response('secret-detail refresh-token-RRRR', { status: 503 })])
    const err = await refreshGrant({
      fetch: down.fetch,
      clientId: CLIENT_ID,
      refreshToken: REFRESH,
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OAuthTokenError)
    expect(err).toMatchObject({ code: 'unavailable', status: 503 })
    expect(String((err as Error).message)).not.toContain('secret-detail')

    const boom = (async () => {
      throw new Error(`connect failed for ${REFRESH}`)
    }) as typeof globalThis.fetch
    const net = await refreshGrant({
      fetch: boom,
      clientId: CLIENT_ID,
      refreshToken: REFRESH,
    }).catch((e: unknown) => e)
    expect(net).toMatchObject({ code: 'unavailable' })
    expect(String((net as Error).message)).not.toContain(REFRESH)
  })

  it('rejects a success body that lacks an access token', async () => {
    const { fetch } = scriptedFetch([json({ token_type: 'Bearer', expires_in: 3600 })])
    await expect(
      refreshGrant({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH }),
    ).rejects.toMatchObject({ code: 'bad_response' })
  })

  it('ignores a non-code error value so prose never becomes a code', async () => {
    const { fetch } = scriptedFetch([json({ error: 'Token refresh-token-RRRR is bad' }, 400)])
    await expect(
      refreshGrant({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH }),
    ).rejects.toMatchObject({ code: 'unknown' })
  })
})

describe('revokeRefreshToken', () => {
  it('posts token, token_type_hint and client_id; an empty 200 is success', async () => {
    const { fetch, calls } = scriptedFetch([new Response('', { status: 200 })])
    await expect(
      revokeRefreshToken({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH }),
    ).resolves.toBe('revoked')
    expect(calls[0]?.url).toBe('https://auth.openai.com/api/accounts/oauth/revoke')
    expect(calls[0]?.headers.get('content-type')).toBe('application/x-www-form-urlencoded')
    expect(calls[0]?.redirect).toBe('error')
    expect(form(calls[0]?.body ?? '')).toEqual({
      token: REFRESH,
      token_type_hint: 'refresh_token',
      client_id: CLIENT_ID,
    })
  })

  it('classifies 5xx and network errors as retryable and other statuses as failed', async () => {
    const run = (res: Response | Error) =>
      revokeRefreshToken({
        fetch: (async () => {
          if (res instanceof Error) throw res
          return res
        }) as typeof globalThis.fetch,
        clientId: CLIENT_ID,
        refreshToken: REFRESH,
      })
    await expect(run(new Response('', { status: 502 }))).resolves.toBe('retry')
    await expect(run(new Error('down'))).resolves.toBe('retry')
    await expect(run(new Response('', { status: 400 }))).resolves.toBe('failed')
  })
})

describe('revokeWithRetry', () => {
  const sleeps: number[] = []
  const sleep = async (ms: number) => void sleeps.push(ms)

  it('retries 5xx with a bounded, growing backoff and confirms on success', async () => {
    sleeps.length = 0
    const { fetch, calls } = scriptedFetch((_c, i) =>
      i < 2 ? new Response('', { status: 503 }) : new Response('', { status: 200 }),
    )
    const ok = await revokeWithRetry({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH, sleep })
    expect(ok).toBe(true)
    expect(calls).toHaveLength(3)
    expect(sleeps).toHaveLength(2)
    expect(sleeps[1]).toBeGreaterThan(sleeps[0] ?? 0)
  })

  it('gives up after the attempt bound and reports it was not confirmed', async () => {
    sleeps.length = 0
    const { fetch, calls } = scriptedFetch([new Response('', { status: 500 })])
    const ok = await revokeWithRetry({
      fetch,
      clientId: CLIENT_ID,
      refreshToken: REFRESH,
      sleep,
      maxAttempts: 3,
    })
    expect(ok).toBe(false)
    expect(calls).toHaveLength(3)
    expect(sleeps).toHaveLength(2)
  })

  it('does not retry a 4xx', async () => {
    const { fetch, calls } = scriptedFetch([new Response('', { status: 400 })])
    const ok = await revokeWithRetry({ fetch, clientId: CLIENT_ID, refreshToken: REFRESH, sleep })
    expect(ok).toBe(false)
    expect(calls).toHaveLength(1)
  })
})
