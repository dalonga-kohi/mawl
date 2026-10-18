import { describe, expect, it } from 'vitest'
import { codeChallenge } from './pkce.ts'
import { beginSignIn, completeSignIn } from './sign-in.ts'
import {
  ALL_SCOPES,
  CLIENT_ID,
  HOST_ID,
  ID_KEYS,
  makeIdToken,
  scriptedFetch,
  tokenResponse,
} from './test-util.ts'

const NOW = 1_800_000_000_000
let seed = 0
const random = (size: number) => new Uint8Array(size).fill(++seed)

function idToken(over: Record<string, unknown> = {}, nonce = 'x', clientId = CLIENT_ID) {
  return makeIdToken({
    iss: 'https://auth.openai.com',
    aud: clientId,
    exp: NOW / 1000 + 600,
    nonce,
    sub: 'sub-1',
    email: 'owner@example.com',
    ...over,
  })
}

function begin(clientId: string | null = null) {
  return beginSignIn({ clientId, hostId: HOST_ID, port: 1455, random })
}

function deps(script: Parameters<typeof scriptedFetch>[0]) {
  const net = scriptedFetch(script)
  const log: string[] = []
  return {
    net,
    log,
    deps: {
      fetch: net.fetch,
      now: () => NOW,
      idTokenKeys: ID_KEYS,
      saveClientId: async (id: string) => void log.push(`save:${id}`),
    },
  }
}

const cb = (attempt: { state: string }, extra: Record<string, string> = {}) =>
  new URLSearchParams({ code: 'the-code', state: attempt.state, scope: ALL_SCOPES, ...extra })

describe('beginSignIn', () => {
  it('draws fresh state, nonce and verifier per attempt and builds a 127.0.0.1 authorize url', () => {
    const a = begin()
    const b = begin()
    expect(new Set([a.state, b.state, a.nonce, b.nonce, a.verifier, b.verifier]).size).toBe(6)
    const q = new URL(a.authorizeUrl).searchParams
    expect(q.get('state')).toBe(a.state)
    expect(q.get('nonce')).toBe(a.nonce)
    expect(q.get('code_challenge')).toBe(codeChallenge(a.verifier))
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(q.get('client_id')).toBe('dynamic_agent_client')
  })

  it('uses a saved client id instead of the placeholder', () => {
    const q = new URL(begin(CLIENT_ID).authorizeUrl).searchParams
    expect(q.get('client_id')).toBe(CLIENT_ID)
  })

  it('never reveals the verifier in the url', () => {
    const a = begin()
    expect(a.authorizeUrl).not.toContain(a.verifier)
  })
})

describe('completeSignIn state and errors', () => {
  it('rejects a state mismatch without touching the network or saving anything', async () => {
    const a = begin()
    const d = deps([tokenResponse()])
    const res = await completeSignIn(a, cb({ state: 'forged' }, { client_id: CLIENT_ID }), d.deps)
    expect(res).toEqual({ ok: false, reason: 'state_mismatch' })
    expect(d.net.calls).toHaveLength(0)
    expect(d.log).toEqual([])
  })

  it('stops on access_denied without exchanging a code', async () => {
    const a = begin()
    const d = deps([tokenResponse()])
    const params = new URLSearchParams({ error: 'access_denied', state: a.state })
    expect(await completeSignIn(a, params, d.deps)).toEqual({ ok: false, reason: 'access_denied' })
    expect(d.net.calls).toHaveLength(0)
  })

  it('treats any other oauth error as a failed attempt', async () => {
    const a = begin()
    const d = deps([tokenResponse()])
    const params = new URLSearchParams({ error: 'server_error', state: a.state })
    expect(await completeSignIn(a, params, d.deps)).toEqual({ ok: false, reason: 'oauth_error' })
  })

  it('fails when the code is missing', async () => {
    const a = begin()
    const d = deps([tokenResponse()])
    const params = new URLSearchParams({ state: a.state, client_id: CLIENT_ID })
    expect(await completeSignIn(a, params, d.deps)).toEqual({ ok: false, reason: 'oauth_error' })
  })
})

describe('completeSignIn client id handling', () => {
  it('persists the issued client id BEFORE the code exchange', async () => {
    const a = begin()
    const log: string[] = []
    const net = scriptedFetch(() => {
      log.push('exchange')
      return tokenResponse({ id_token: idToken({}, a.nonce) })
    })
    await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), {
      fetch: net.fetch,
      now: () => NOW,
      idTokenKeys: ID_KEYS,
      saveClientId: async (id) => void log.push(`save:${id}`),
    })
    expect(log).toEqual([`save:${CLIENT_ID}`, 'exchange'])
  })

  it('persists the issued id when the exchange then fails, so the next try reuses it', async () => {
    const a = begin()
    const d = deps([new Response('{"error":"invalid_grant"}', { status: 400 })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    expect(res).toEqual({ ok: false, reason: 'exchange_failed' })
    expect(d.log).toEqual([`save:${CLIENT_ID}`])
  })

  it('exchanges with the issued id, never with dynamic_agent_client', async () => {
    const a = begin()
    const d = deps([tokenResponse({ id_token: idToken({}, a.nonce) })])
    await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    const body = new URLSearchParams(d.net.calls[0]?.body)
    expect(body.get('client_id')).toBe(CLIENT_ID)
    expect(body.get('code_verifier')).toBe(a.verifier)
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(d.log.join()).not.toContain('dynamic_agent_client')
  })

  it.each([
    ['missing', {}],
    ['the dynamic placeholder', { client_id: 'dynamic_agent_client' }],
    ['not an oaiapp id', { client_id: 'something_else' }],
  ])('treats a new registration with a %s client id as incomplete', async (_n, extra) => {
    const a = begin()
    const d = deps([tokenResponse()])
    expect(await completeSignIn(a, cb(a, extra), d.deps)).toEqual({
      ok: false,
      reason: 'registration_incomplete',
    })
    expect(d.log).toEqual([])
    expect(d.net.calls).toHaveLength(0)
  })

  it('reuses the saved id on a returning sign-in even if the callback omits it', async () => {
    const a = begin(CLIENT_ID)
    const d = deps([tokenResponse({ id_token: idToken({}, a.nonce) })])
    const res = await completeSignIn(a, cb(a), d.deps)
    expect(res.ok).toBe(true)
    expect(new URLSearchParams(d.net.calls[0]?.body).get('client_id')).toBe(CLIENT_ID)
    expect(d.log).toEqual([])
  })

  it('rejects a callback that supplies a different client id than the saved one', async () => {
    const a = begin(CLIENT_ID)
    const d = deps([tokenResponse()])
    const res = await completeSignIn(a, cb(a, { client_id: 'oaiapp_other' }), d.deps)
    expect(res).toEqual({ ok: false, reason: 'client_mismatch' })
    expect(d.net.calls).toHaveLength(0)
  })
})

describe('completeSignIn success and id token', () => {
  it('returns the stored credential, account identity and plan usage', async () => {
    const a = begin()
    const d = deps([tokenResponse({ id_token: idToken({}, a.nonce) })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    expect(res).toMatchObject({
      ok: true,
      clientId: CLIENT_ID,
      subject: 'sub-1',
      accountEmail: 'owner@example.com',
      planUsage: true,
      credential: {
        clientId: CLIENT_ID,
        accessToken: 'access-token-AAAA',
        refreshToken: 'refresh-token-RRRR',
        expiresAt: NOW + 3600 * 1000,
        scope: ALL_SCOPES,
      },
    })
  })

  it('keeps the sign-in but disables plan usage when the direct scope was not granted', async () => {
    const a = begin()
    const scope = 'openid profile email offline_access'
    const d = deps([tokenResponse({ scope, id_token: idToken({}, a.nonce) })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    expect(res).toMatchObject({ ok: true, planUsage: false, credential: { scope } })
  })

  it.each([
    ['nonce', { nonce: 'other' }],
    ['audience', { aud: 'oaiapp_someone_else' }],
    ['issuer', { iss: 'https://evil.example' }],
    ['expiry', { exp: NOW / 1000 - 5 }],
  ])('rejects an ID token with a wrong %s', async (_n, over) => {
    const a = begin()
    const d = deps([tokenResponse({ id_token: idToken({ nonce: a.nonce, ...over }) })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    expect(res).toEqual({ ok: false, reason: 'invalid_id_token' })
  })

  it('rejects an ID token signed by an unknown key', async () => {
    const a = begin()
    const claims = {
      iss: 'https://auth.openai.com',
      aud: CLIENT_ID,
      exp: NOW / 1000 + 600,
      nonce: a.nonce,
      sub: 's',
    }
    const d = deps([tokenResponse({ id_token: makeIdToken(claims, true) })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    expect(res).toEqual({ ok: false, reason: 'invalid_id_token' })
  })

  it('rejects a token response without an id token or refresh token', async () => {
    const a = begin()
    const noId = deps([tokenResponse({ id_token: undefined })])
    expect(await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), noId.deps)).toEqual({
      ok: false,
      reason: 'invalid_id_token',
    })
    const b = begin()
    const noRefresh = deps([
      tokenResponse({ refresh_token: undefined, id_token: idToken({}, b.nonce) }),
    ])
    expect(await completeSignIn(b, cb(b, { client_id: CLIENT_ID }), noRefresh.deps)).toEqual({
      ok: false,
      reason: 'exchange_failed',
    })
  })

  it('does not echo tokens, codes or state in a failure result', async () => {
    const a = begin()
    const d = deps([tokenResponse({ id_token: idToken({ nonce: 'bad' }) })])
    const res = await completeSignIn(a, cb(a, { client_id: CLIENT_ID }), d.deps)
    const text = JSON.stringify(res)
    for (const secret of [a.state, a.nonce, a.verifier, 'the-code', 'access-token-AAAA']) {
      expect(text).not.toContain(secret)
    }
  })
})
