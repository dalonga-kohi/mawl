import { generateKeyPairSync } from 'node:crypto'
import { createLocalJWKSet, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { createChatGptFetch } from './fetch.ts'
import { IdTokenError, verifyIdToken } from './id-token.ts'
import { beginSignIn, completeSignIn, stateMatches } from './sign-in.ts'
import {
  ALL_SCOPES,
  CLIENT_ID,
  HOST_ID,
  ID_KEYS,
  json,
  makeIdToken,
  memoryStore,
  REFRESH,
  scriptedFetch,
  sse,
  stored,
  tokenResponse,
} from './test-util.ts'
import {
  createTokenManager,
  discardPendingCredential,
  type TokenManager,
  withCredentialLock,
} from './token-manager.ts'

const NOW = 1_800_000_000_000

// ---------------------------------------------------------------------------------------------
// Bearer destination
// ---------------------------------------------------------------------------------------------

describe('chatgpt fetch wrapper: destination (hardening)', () => {
  const body = JSON.stringify({ model: 'gpt-x', input: [], stream: true })
  const OK = () => sse({ type: 'response.completed', response: { id: 'r' } })

  function spyTokens() {
    let asked = 0
    const tokens: TokenManager = {
      getAccessToken: async () => {
        asked++
        return 'bearer-1'
      },
      refreshAfterRejection: async () => 'bearer-2',
    }
    return { tokens, asked: () => asked }
  }

  it.each([
    'https://api.openai.com@evil.example/v1/responses',
    'https://api.openai.com:pw@evil.example/v1/responses',
    'https://evil.example/@api.openai.com/v1/responses',
    'https://evil.example\\@api.openai.com/v1/responses',
    'https://evil.example/v1/responses?host=api.openai.com',
    'https://evil.example#@api.openai.com/v1/responses',
    'https://API.OPENAI.COM.evil.example/v1/responses',
    'https://api.openai.com.:8443/v1/responses',
    'https://sub.api.openai.com/v1/responses',
    'https://api-openai.com/v1/responses',
    'https://xn--pi-openai-9fb.com/v1/responses',
    'ftp://api.openai.com/v1/responses',
    'wss://api.openai.com/v1/responses',
  ])('never sends the bearer to %s', async (target) => {
    const net = scriptedFetch([OK()])
    const t = spyTokens()
    const f = createChatGptFetch({ tokens: t.tokens, fetch: net.fetch })
    await expect(
      f(target, { method: 'POST', body }).catch((e: unknown) => {
        throw e
      }),
    ).rejects.toBeDefined()
    expect(net.calls).toHaveLength(0)
    expect(t.asked()).toBe(0)
  })

  it('checks the url of a Request input, not only string inputs', async () => {
    const net = scriptedFetch([OK()])
    const t = spyTokens()
    const f = createChatGptFetch({ tokens: t.tokens, fetch: net.fetch })
    const req = new Request('https://evil.example/v1/responses', { method: 'POST', body })
    await expect(f(req, { method: 'POST', body })).rejects.toMatchObject({
      reason: 'config_error',
    })
    expect(net.calls).toHaveLength(0)
    expect(t.asked()).toBe(0)
  })

  it('checks the url of a URL input', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: spyTokens().tokens, fetch: net.fetch })
    await expect(
      f(new URL('http://api.openai.com/v1/responses'), { method: 'POST', body }),
    ).rejects.toMatchObject({ reason: 'config_error' })
    expect(net.calls).toHaveLength(0)
  })

  it('accepts a Request input and a URL input that point at api.openai.com', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: spyTokens().tokens, fetch: net.fetch })
    await f(new URL('https://api.openai.com/v1/responses'), { method: 'POST', body })
    await f(new Request('https://API.OPENAI.COM/v1/responses', { method: 'POST', body }), {
      method: 'POST',
      body,
    })
    expect(net.calls).toHaveLength(2)
    for (const c of net.calls) expect(c.headers.get('authorization')).toBe('Bearer bearer-1')
  })

  it('rejects before reading the token when the url is unparsable', async () => {
    const net = scriptedFetch([OK()])
    const t = spyTokens()
    const f = createChatGptFetch({ tokens: t.tokens, fetch: net.fetch })
    await expect(f('not a url', { method: 'POST', body })).rejects.toBeDefined()
    expect(net.calls).toHaveLength(0)
    expect(t.asked()).toBe(0)
  })

  it('sends the retry after a 401 only to api.openai.com too, with the renewed bearer', async () => {
    const net = scriptedFetch((_c, i) => (i === 0 ? new Response('', { status: 401 }) : OK()))
    const f = createChatGptFetch({ tokens: spyTokens().tokens, fetch: net.fetch })
    await f('https://api.openai.com/v1/responses', { method: 'POST', body })
    expect(net.calls.map((c) => c.url)).toEqual([
      'https://api.openai.com/v1/responses',
      'https://api.openai.com/v1/responses',
    ])
    expect(net.calls[1]?.headers.get('authorization')).toBe('Bearer bearer-2')
    expect(net.calls.every((c) => c.redirect === 'error')).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// OAuth state on the callback
// ---------------------------------------------------------------------------------------------

describe('state comparison (hardening)', () => {
  let seed = 0
  const random = (size: number) => new Uint8Array(size).fill(++seed)
  const attempt = () => beginSignIn({ clientId: null, hostId: HOST_ID, port: 1455, random })
  const deps = () => {
    const net = scriptedFetch([tokenResponse()])
    return {
      net,
      deps: {
        fetch: net.fetch,
        now: () => NOW,
        idTokenKeys: ID_KEYS,
        saveClientId: async () => {},
      },
    }
  }

  it.each([
    ['a longer state that starts with the real one', (s: string) => `${s}EXTRA`],
    ['a truncated state', (s: string) => s.slice(0, -1)],
    ['an empty state', () => ''],
    ['a one-character state', (s: string) => s.slice(0, 1)],
    ['a unicode state of the same character count', (s: string) => 'é'.repeat(s.length)],
    ['a state with a trailing space', (s: string) => `${s} `],
    [
      'a state in other case',
      (s: string) => (s.toUpperCase() === s ? s.toLowerCase() : s.toUpperCase()),
    ],
  ])('rejects %s without a request or a client id save', async (_n, mutate) => {
    const a = attempt()
    const d = deps()
    const params = new URLSearchParams({
      code: 'c',
      state: mutate(a.state),
      client_id: CLIENT_ID,
    })
    expect(stateMatches(a, params)).toBe(false)
    expect(await completeSignIn(a, params, d.deps)).toEqual({ ok: false, reason: 'state_mismatch' })
    expect(d.net.calls).toHaveLength(0)
  })

  it('rejects a missing state parameter', async () => {
    const a = attempt()
    const params = new URLSearchParams({ code: 'c', client_id: CLIENT_ID })
    expect(stateMatches(a, params)).toBe(false)
    expect(await completeSignIn(a, params, deps().deps)).toEqual({
      ok: false,
      reason: 'state_mismatch',
    })
  })

  it('checks the state before it looks at an error or a missing code', async () => {
    const a = attempt()
    for (const extra of [{ error: 'access_denied' }, { error: 'server_error' }, {}]) {
      const params = new URLSearchParams({ state: 'forged', ...extra })
      expect(await completeSignIn(a, params, deps().deps)).toEqual({
        ok: false,
        reason: 'state_mismatch',
      })
    }
  })

  it('reads the first state when the parameter repeats, so a forged duplicate cannot win', () => {
    const a = attempt()
    expect(stateMatches(a, new URLSearchParams(`state=forged&state=${a.state}`))).toBe(false)
    expect(stateMatches(a, new URLSearchParams(`state=${a.state}&state=forged`))).toBe(true)
  })

  it('accepts exactly the issued state', () => {
    const a = attempt()
    expect(stateMatches(a, new URLSearchParams({ state: a.state }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------------------------
// ID token
// ---------------------------------------------------------------------------------------------

describe('verifyIdToken (hardening)', () => {
  const good = {
    iss: 'https://auth.openai.com',
    aud: CLIENT_ID,
    exp: NOW / 1000 + 600,
    nonce: 'n0nce',
    sub: 'user-sub-1',
  }
  const checks = { clientId: CLIENT_ID, nonce: 'n0nce', now: NOW, keys: ID_KEYS }
  const failure = async (p: Promise<unknown>) => {
    const err = await p.then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(IdTokenError)
    return err as IdTokenError
  }

  it.each([
    'https://auth.openai.com.evil.example',
    'https://auth.openai.com/',
    'https://auth.openai.comx',
    'http://auth.openai.com',
    'HTTPS://AUTH.OPENAI.COM',
  ])('rejects the lookalike issuer %s', async (iss) => {
    expect((await failure(verifyIdToken(makeIdToken({ ...good, iss }), checks))).check).toBe(
      'issuer',
    )
  })

  it('rejects a token that expires exactly now', async () => {
    const t = makeIdToken({ ...good, exp: NOW / 1000 })
    expect((await failure(verifyIdToken(t, checks))).check).toBe('expiry')
    const ok = makeIdToken({ ...good, exp: NOW / 1000 + 1 })
    await expect(verifyIdToken(ok, checks)).resolves.toMatchObject({ subject: 'user-sub-1' })
  })

  it('accepts only RS256: a PS256 token signed by the trusted RSA key is refused', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    // No `alg` on the published key, so only the verifier's allow-list can refuse PS256.
    const keys = createLocalJWKSet({
      keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'k9' }],
    })
    const ps = await new SignJWT(good)
      .setProtectedHeader({ alg: 'PS256', kid: 'k9' })
      .sign(privateKey)
    expect((await failure(verifyIdToken(ps, { ...checks, keys }))).check).toBe('signature')
    const rs = await new SignJWT(good)
      .setProtectedHeader({ alg: 'RS256', kid: 'k9' })
      .sign(privateKey)
    await expect(verifyIdToken(rs, { ...checks, keys })).resolves.toMatchObject({
      subject: 'user-sub-1',
    })
  })

  it('fails closed as invalid_id_token at sign-in when the key set cannot be fetched', async () => {
    let seed = 100
    const a = beginSignIn({
      clientId: CLIENT_ID,
      hostId: HOST_ID,
      port: 1455,
      random: (n) => new Uint8Array(n).fill(++seed),
    })
    const net = scriptedFetch([
      tokenResponse({ id_token: makeIdToken({ ...good, nonce: a.nonce }) }),
    ])
    const keys = (async () => {
      throw new Error('JWKS endpoint down')
    }) as unknown as typeof ID_KEYS
    const res = await completeSignIn(
      a,
      new URLSearchParams({ code: 'c', state: a.state, scope: ALL_SCOPES }),
      { fetch: net.fetch, now: () => NOW, idTokenKeys: keys, saveClientId: async () => {} },
    )
    expect(res).toEqual({ ok: false, reason: 'invalid_id_token' })
  })

  it('refuses an expired ID token at sign-in', async () => {
    let seed = 200
    const a = beginSignIn({
      clientId: CLIENT_ID,
      hostId: HOST_ID,
      port: 1455,
      random: (n) => new Uint8Array(n).fill(++seed),
    })
    const idToken = makeIdToken({ ...good, nonce: a.nonce, exp: NOW / 1000 - 1 })
    const net = scriptedFetch([tokenResponse({ id_token: idToken })])
    const res = await completeSignIn(
      a,
      new URLSearchParams({ code: 'c', state: a.state, scope: ALL_SCOPES }),
      { fetch: net.fetch, now: () => NOW, idTokenKeys: ID_KEYS, saveClientId: async () => {} },
    )
    expect(res).toEqual({ ok: false, reason: 'invalid_id_token' })
  })
})

// ---------------------------------------------------------------------------------------------
// Credential lock and pending rotation
// ---------------------------------------------------------------------------------------------

describe('withCredentialLock', () => {
  const deferred = () => {
    let resolve!: () => void
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('runs jobs for one key strictly in order, even when an earlier one is slow', async () => {
    const order: string[] = []
    const gate = deferred()
    const first = withCredentialLock('lock-order', async () => {
      order.push('first:start')
      await gate.promise
      order.push('first:end')
    })
    const second = withCredentialLock('lock-order', async () => {
      order.push('second:start')
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(order).toEqual(['first:start'])
    gate.resolve()
    await Promise.all([first, second])
    expect(order).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('does not stall later jobs after a job fails, and still reports that failure', async () => {
    const failing = withCredentialLock('lock-fail', async () => {
      throw new Error('boom')
    })
    const next = withCredentialLock('lock-fail', async () => 'ran')
    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ran')
  })

  it('lets different keys run in parallel', async () => {
    const gate = deferred()
    const a = withCredentialLock('lock-a', () => gate.promise)
    const b = await withCredentialLock('lock-b', async () => 'b-done')
    expect(b).toBe('b-done')
    gate.resolve()
    await a
  })

  it('makes a refresh wait for an earlier sign-in write on the same credential', async () => {
    const gate = deferred()
    const store = memoryStore(stored({ expiresAt: NOW }))
    const net = scriptedFetch([tokenResponse({ access_token: 'a2', refresh_token: 'r2' })])
    const tokens = createTokenManager({
      credentialId: 'lock-vs-refresh',
      store,
      fetch: net.fetch,
      now: () => NOW,
    })
    const write = withCredentialLock('lock-vs-refresh', () => gate.promise)
    const refreshed = tokens.getAccessToken()
    await new Promise((r) => setTimeout(r, 20))
    expect(net.calls).toHaveLength(0)
    gate.resolve()
    await write
    expect(await refreshed).toBe('a2')
    expect(net.calls).toHaveLength(1)
  })
})

describe('token manager pending rotation (hardening)', () => {
  /** A store whose saves fail while `broken` is set, and whose clear is unconditional. */
  function brokenStore() {
    const base = memoryStore(stored({ expiresAt: NOW }))
    let broken = true
    return {
      base,
      heal: () => {
        broken = false
      },
      store: {
        load: () => base.load(),
        save: async (next: Parameters<typeof base.save>[0]) => {
          if (broken) throw new Error('db down')
          await base.save(next)
        },
        clearTokens: async (_failed: string) => {
          // Unconditional: isolates the manager's own pending bookkeeping from the store guard.
          base.current.accessToken = null
          base.current.refreshToken = null
          base.current.idToken = null
          base.current.expiresAt = 0
        },
      },
    }
  }

  it('forgets an unsaved rotation once its refresh token is rejected for good', async () => {
    const { store, heal, base } = brokenStore()
    const net = scriptedFetch((_c, i) =>
      i === 0
        ? tokenResponse({ access_token: 'a2', refresh_token: 'r2' })
        : json({ error: 'invalid_grant' }, 400),
    )
    const tokens = createTokenManager({
      credentialId: 'pending-terminal',
      store,
      fetch: net.fetch,
      now: () => NOW,
    })
    expect(await tokens.getAccessToken()).toBe('a2')
    await expect(tokens.refreshAfterRejection('a2')).rejects.toMatchObject({
      reason: 'reauth_required',
    })
    heal()
    const before = net.calls.length
    // The dead rotation must not be re-saved or retried: the owner has to sign in again.
    await expect(tokens.getAccessToken()).rejects.toMatchObject({ reason: 'reauth_required' })
    expect(net.calls).toHaveLength(before)
    expect(base.current.refreshToken).toBeNull()
  })

  it('discardPendingCredential drops an unsaved rotation so the stored credential wins', async () => {
    let row = stored({ expiresAt: NOW })
    const saved: string[] = []
    let broken = true
    const store = {
      load: async () => row,
      save: async (next: typeof row) => {
        if (broken) throw new Error('db down')
        saved.push(next.refreshToken ?? '')
        row = next
      },
      clearTokens: async () => {},
    }
    const net = scriptedFetch([tokenResponse({ access_token: 'a2', refresh_token: 'r2' })])
    const tokens = createTokenManager({
      credentialId: 'pending-discard',
      store,
      fetch: net.fetch,
      now: () => NOW,
    })
    expect(await tokens.getAccessToken()).toBe('a2')
    expect(row.refreshToken).toBe(REFRESH)
    // A newer sign-in replaces the row; the rotation of the old login must be forgotten.
    row = stored({ accessToken: 'signed-in', refreshToken: 'r-new', expiresAt: NOW + 3_600_000 })
    discardPendingCredential('pending-discard')
    broken = false
    expect(await tokens.getAccessToken()).toBe('signed-in')
    expect(saved).toEqual([])
    expect(row.refreshToken).toBe('r-new')
    expect(net.calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------------------------
// Error body handling
// ---------------------------------------------------------------------------------------------

describe('chatgpt fetch wrapper: rate limit headers (hardening)', () => {
  const body = JSON.stringify({ model: 'gpt-x', input: [], stream: true })
  const tokens: TokenManager = {
    getAccessToken: async () => 'b',
    refreshAfterRejection: async () => 'b2',
  }

  it.each([
    ['-5', undefined],
    ['1e9', undefined],
    ['abc', undefined],
    ['9999999', undefined],
    ['12.5', undefined],
    ['0', 0],
    ['120', 120],
  ])('reads retry-after %s as %s', async (raw, expected) => {
    const net = scriptedFetch([
      json({ error: { code: 'subscription_sharing_usage_limit_exceeded' } }, 429, {
        'retry-after': raw,
      }),
    ])
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    const err = (await f('https://api.openai.com/v1/responses', { method: 'POST', body }).catch(
      (e: unknown) => e,
    )) as ProviderFailureError
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect(err.reason).toBe('plan_limit_reached')
    expect(err.retryAfter).toBe(expected)
  })
})
