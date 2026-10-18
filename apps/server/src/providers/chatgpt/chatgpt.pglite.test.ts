import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { ChatGptAttemptStatus, ProviderCredential } from '@faire/contracts'
import { parseStoredCredential } from '@faire/core'
import { migrationsFolder, schema } from '@faire/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../../logger.ts'
import { createSecretBox } from '../../secrets/index.ts'
import { createProviderService, type ProviderService } from '../service.ts'
import {
  ALL_SCOPES,
  type Call,
  CLIENT_ID,
  EMAIL,
  fakeFetch,
  fakeListeners,
  HOST_ID,
  ID_KEYS,
  json,
  makeIdToken,
  NOW,
  tokenBody,
} from './test-util.ts'

const { providerCredentials, oauthClients } = schema
const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
const REVOKE_URL = 'https://auth.openai.com/api/accounts/oauth/revoke'

describe('Sign in with ChatGPT on the server (PGlite)', () => {
  let client: PGlite
  let db: ReturnType<typeof drizzle<typeof schema>>
  let logLines: string[]
  let listeners: ReturnType<typeof fakeListeners>
  let respond: (call: Call, index: number) => Response | Promise<Response>
  let calls: Call[]
  let sleeps: number[]
  let timers: Array<{ fn: () => void; ms: number; cancelled: boolean }>
  let clock: number

  beforeEach(async () => {
    client = new PGlite({ extensions: { vector } })
    db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    logLines = []
    listeners = fakeListeners()
    sleeps = []
    timers = []
    clock = NOW
    // Default: sign-in succeeds; every other host answers 200.
    respond = (call) => {
      if (call.url === TOKEN_URL) return json(tokenBody({ id_token: idTokenFor(call) }))
      return new Response('', { status: 200 })
    }
  })

  afterEach(async () => {
    await client.close()
  })

  /** The ID token the fake OpenAI would issue for the nonce of the pending attempt. */
  let nonce = ''
  const idTokenFor = (_call: Call) =>
    makeIdToken({
      iss: 'https://auth.openai.com',
      aud: CLIENT_ID,
      exp: NOW / 1000 + 7200,
      nonce,
      sub: 'sub-1',
      email: EMAIL,
    })

  async function setup(hostId: string | null = HOST_ID) {
    const box = await createSecretBox(new Uint8Array(randomBytes(32)))
    const logger = createLogger({
      level: 'trace',
      stream: { write: (chunk: string) => void logLines.push(chunk) },
    })
    const net = fakeFetch((call, i) => respond(call, i))
    calls = net.calls
    const service = createProviderService({
      db,
      secretBox: box,
      logger,
      fetch: net.fetch,
      chatgpt: {
        hostId,
        port: 1455,
        bindHost: '127.0.0.1',
        startListener: listeners.start,
        idTokenKeys: ID_KEYS,
        now: () => clock,
        random: (n) => new Uint8Array(randomBytes(n)),
        sleep: async (ms) => void sleeps.push(ms),
        setTimer: (fn, ms) => {
          const t = { fn, ms, cancelled: false }
          timers.push(t)
          return () => {
            t.cancelled = true
          }
        },
      },
    })
    return { service, box }
  }

  /** Starts an attempt and delivers a callback built from its authorize url. */
  async function signIn(service: ProviderService, over: Record<string, string | null> = {}) {
    const { attemptId, authorizeUrl } = await service.startChatGptSignIn()
    const q = new URL(authorizeUrl).searchParams
    nonce = q.get('nonce') ?? ''
    const params: Record<string, string> = {
      code: 'the-code',
      state: q.get('state') ?? '',
      scope: ALL_SCOPES,
      client_id: CLIENT_ID,
    }
    for (const [k, v] of Object.entries(over)) {
      if (v === null) delete params[k]
      else params[k] = v
    }
    await listeners.last()?.callback(params)
    return { attemptId, authorizeUrl, q }
  }

  it('starts an attempt: a loopback listener on 127.0.0.1:1455 and a first-registration authorize url', async () => {
    const { service } = await setup()
    const { attemptId, authorizeUrl } = await service.startChatGptSignIn()
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/)
    expect(listeners.made).toHaveLength(1)
    expect(listeners.last()).toMatchObject({ host: '127.0.0.1', port: 1455, closed: false })
    const q = new URL(authorizeUrl).searchParams
    expect(q.get('client_id')).toBe('dynamic_agent_client')
    expect(q.get('ext_agent_host_id')).toBe(HOST_ID)
    expect(q.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(ChatGptAttemptStatus.parse(service.chatGptSignInStatus(attemptId))).toEqual({
      status: 'pending',
    })
  })

  it('stores the credential encrypted, persists the issued client id, and reports success', async () => {
    const { service, box } = await setup()
    const { attemptId } = await signIn(service)
    const status = service.chatGptSignInStatus(attemptId)
    expect(status.status).toBe('succeeded')
    if (status.status !== 'succeeded') return

    const listed = await service.list()
    expect(listed).toHaveLength(1)
    const [pub] = listed
    expect(ProviderCredential.safeParse(pub).success).toBe(true)
    expect(pub).toMatchObject({
      id: status.credentialId,
      provider: 'openai_chatgpt',
      baseUrl: null,
      accountEmail: EMAIL,
      planUsage: true,
      reauthRequired: false,
    })
    expect(JSON.stringify(pub)).not.toContain('access-token-AAAA')

    const [row] = await db.select().from(providerCredentials)
    const raw = Buffer.from(row?.secretEnc ?? []).toString('latin1')
    expect(raw).not.toContain('access-token-AAAA')
    expect(raw).not.toContain('refresh-token-RRRR')
    const blob = parseStoredCredential(
      box.decrypt(row?.secretEnc as Uint8Array, `provider_credentials:${status.credentialId}`),
    )
    expect(blob).toMatchObject({
      clientId: CLIENT_ID,
      accessToken: 'access-token-AAAA',
      refreshToken: 'refresh-token-RRRR',
      expiresAt: NOW + 3600 * 1000,
      scope: ALL_SCOPES,
    })

    const clients = await db.select().from(oauthClients)
    expect(clients.map((c) => c.clientId)).toEqual([CLIENT_ID])
    expect(row?.oauthClientId).toBe(CLIENT_ID)
    // One-shot: the listener is closed once the attempt ended.
    expect(listeners.last()?.closed).toBe(true)
  })

  it('persists the issued client id before the code exchange and keeps it if the exchange fails', async () => {
    const { service } = await setup()
    let clientsAtExchange = -1
    respond = async (call) => {
      if (call.url === TOKEN_URL) {
        clientsAtExchange = (await db.select().from(oauthClients)).length
        return json({ error: 'invalid_grant' }, 400)
      }
      return new Response('', { status: 200 })
    }
    const { attemptId } = await signIn(service)
    expect(clientsAtExchange).toBe(1)
    expect(service.chatGptSignInStatus(attemptId)).toEqual({
      status: 'failed',
      reason: 'exchange_failed',
    })
    expect(await service.list()).toEqual([])
    expect((await db.select().from(oauthClients)).map((c) => c.clientId)).toEqual([CLIENT_ID])
  })

  it('reuses the saved client id on the next sign-in and never stores dynamic_agent_client', async () => {
    const { service } = await setup()
    await signIn(service)
    const second = await service.startChatGptSignIn()
    expect(new URL(second.authorizeUrl).searchParams.get('client_id')).toBe(CLIENT_ID)
    const ids = (await db.select().from(oauthClients)).map((c) => c.clientId)
    expect(ids).not.toContain('dynamic_agent_client')
    expect(ids).toEqual([CLIENT_ID])
  })

  it('re-signing in updates the same credential instead of adding another', async () => {
    const { service } = await setup()
    const first = await signIn(service)
    const firstStatus = service.chatGptSignInStatus(first.attemptId)
    // Simulate a cleared credential that needs reauth.
    await db.update(providerCredentials).set({ reauthRequired: true })
    const second = await signIn(service, { client_id: null })
    const secondStatus = service.chatGptSignInStatus(second.attemptId)
    expect(secondStatus).toEqual(firstStatus)
    const rows = await service.list()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.reauthRequired).toBe(false)
  })

  it('keeps the sign-in but disables plan usage when the direct scope is missing', async () => {
    const { service } = await setup()
    respond = (call) =>
      call.url === TOKEN_URL
        ? json(
            tokenBody({ scope: 'openid profile email offline_access', id_token: idTokenFor(call) }),
          )
        : new Response('', { status: 200 })
    await signIn(service)
    const [pub] = await service.list()
    expect(pub).toMatchObject({ provider: 'openai_chatgpt', planUsage: false })
    const model = await service.createModel(pub?.id as never, 'gpt-x')
    await expect(
      model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    ).rejects.toMatchObject({
      reason: 'plan_usage_disabled',
    })
  })

  it.each([
    ['access_denied', { error: 'access_denied' }, 'access_denied'],
    ['an incomplete registration', { client_id: null }, 'registration_incomplete'],
  ])('fails the attempt on %s and stores nothing', async (_n, over, reason) => {
    const { service } = await setup()
    const { attemptId } = await signIn(service, over)
    expect(service.chatGptSignInStatus(attemptId)).toEqual({ status: 'failed', reason })
    expect(await service.list()).toEqual([])
    expect(listeners.last()?.closed).toBe(true)
    expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(0)
  })

  it('ignores a forged-state callback and still completes with the real one', async () => {
    const { service } = await setup()
    const { attemptId, authorizeUrl } = await service.startChatGptSignIn()
    const q = new URL(authorizeUrl).searchParams
    nonce = q.get('nonce') ?? ''
    const real = {
      code: 'the-code',
      state: q.get('state') ?? '',
      scope: ALL_SCOPES,
      client_id: CLIENT_ID,
    }
    expect(await listeners.last()?.callback({ ...real, state: 'forged' })).toBe(false)
    expect(await listeners.last()?.callback({ code: 'x' })).toBe(false)
    expect(service.chatGptSignInStatus(attemptId)).toEqual({ status: 'pending' })
    expect(listeners.last()?.closed).toBe(false)
    expect(await listeners.last()?.callback(real)).toBe(true)
    expect(service.chatGptSignInStatus(attemptId).status).toBe('succeeded')
  })

  it('a second start cancels the first attempt and closes its listener', async () => {
    const { service } = await setup()
    const first = await service.startChatGptSignIn()
    const second = await service.startChatGptSignIn()
    expect(second.attemptId).not.toBe(first.attemptId)
    expect(service.chatGptSignInStatus(first.attemptId)).toEqual({
      status: 'failed',
      reason: 'cancelled',
    })
    expect(service.chatGptSignInStatus(second.attemptId)).toEqual({ status: 'pending' })
    expect(listeners.made[0]?.closed).toBe(true)
    expect(listeners.made[1]?.closed).toBe(false)
  })

  it('does not cancel an attempt whose code exchange is running: a new start waits for it', async () => {
    const { service } = await setup()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    respond = async (call) => {
      if (call.url !== TOKEN_URL) return new Response('', { status: 200 })
      await gate
      return json(tokenBody({ id_token: idTokenFor(call) }))
    }
    const first = await service.startChatGptSignIn()
    const q = new URL(first.authorizeUrl).searchParams
    nonce = q.get('nonce') ?? ''
    const delivered = listeners.last()?.callback({
      code: 'the-code',
      state: q.get('state') ?? '',
      scope: ALL_SCOPES,
      client_id: CLIENT_ID,
    })
    await vi.waitFor(() => expect(calls.some((c) => c.url === TOKEN_URL)).toBe(true))
    const secondStart = service.startChatGptSignIn()
    release()
    await delivered
    const second = await secondStart
    // What the app is told matches what happened: the sign-in succeeded and is stored.
    expect(service.chatGptSignInStatus(first.attemptId).status).toBe('succeeded')
    expect(await service.list()).toHaveLength(1)
    expect(service.chatGptSignInStatus(second.attemptId)).toEqual({ status: 'pending' })
    expect(new URL(second.authorizeUrl).searchParams.get('client_id')).toBe(CLIENT_ID)
  })

  it('expires an attempt after 10 minutes and closes its listener', async () => {
    const { service } = await setup()
    const { attemptId } = await service.startChatGptSignIn()
    expect(timers).toHaveLength(1)
    expect(timers[0]?.ms).toBe(10 * 60 * 1000)
    timers[0]?.fn()
    await Promise.resolve()
    expect(service.chatGptSignInStatus(attemptId)).toEqual({ status: 'failed', reason: 'expired' })
    expect(listeners.last()?.closed).toBe(true)
  })

  it('cancels the expiry timer once the attempt ends', async () => {
    const { service } = await setup()
    await signIn(service)
    expect(timers[0]?.cancelled).toBe(true)
  })

  it('answers NOT_FOUND-style for an unknown attempt id', async () => {
    const { service } = await setup()
    expect(() => service.chatGptSignInStatus('00000000-0000-4000-8000-000000000000')).toThrow(
      /attempt/i,
    )
  })

  it('refuses to start without a host id', async () => {
    const { service } = await setup(null)
    await expect(service.startChatGptSignIn()).rejects.toMatchObject({
      name: 'SignInUnavailableError',
      why: 'not_configured',
    })
  })

  it('never logs tokens, codes, state, nonce, verifier or the email', async () => {
    const { service } = await setup()
    const { q } = await signIn(service)
    const text = logLines.join('')
    expect(text).toContain('chatgpt sign-in')
    for (const secret of [
      'access-token-AAAA',
      'refresh-token-RRRR',
      'the-code',
      q.get('state') ?? 'x',
      q.get('nonce') ?? 'x',
      q.get('code_challenge') ?? 'x',
      EMAIL,
    ]) {
      expect(text).not.toContain(secret)
    }
  })

  it('refuses to create a ChatGPT credential from an api input', async () => {
    const { service } = await setup()
    await expect(
      service.create({ provider: 'openai_chatgpt', label: 'x', secret: 'y' }),
    ).rejects.toThrow(/Sign in with ChatGPT/)
  })

  describe('with a stored credential', () => {
    async function signedIn() {
      const made = await setup()
      await signIn(made.service)
      const [pub] = await made.service.list()
      return { ...made, id: pub?.id as NonNullable<typeof pub>['id'] }
    }

    const MIN = 60_000

    it('test() uses a still-valid access token without refreshing', async () => {
      const { service, id } = await signedIn()
      calls.length = 0
      const result = await service.test({ id })
      expect(result.ok).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe('https://api.openai.com/v1/models')
      expect(calls[0]?.headers.get('authorization')).toBe('Bearer access-token-AAAA')
    })

    it('refreshes near expiry, persists the rotated refresh token, then uses the new access token', async () => {
      const { service, box, id } = await signedIn()
      clock = NOW + 3600 * 1000 - 4 * MIN
      respond = (call) =>
        call.url === TOKEN_URL
          ? json(tokenBody({ access_token: 'access-2', refresh_token: 'refresh-2' }))
          : new Response('', { status: 200 })
      calls.length = 0
      expect((await service.test({ id })).ok).toBe(true)
      expect(calls.map((c) => c.url)).toEqual([TOKEN_URL, 'https://api.openai.com/v1/models'])
      expect(new URLSearchParams(calls[0]?.body).get('refresh_token')).toBe('refresh-token-RRRR')
      expect(calls[1]?.headers.get('authorization')).toBe('Bearer access-2')
      const [row] = await db.select().from(providerCredentials)
      const blob = parseStoredCredential(
        box.decrypt(row?.secretEnc as Uint8Array, `provider_credentials:${id}`),
      )
      expect(blob).toMatchObject({ accessToken: 'access-2', refreshToken: 'refresh-2' })
    })

    it('runs one refresh for concurrent callers', async () => {
      const { service, id } = await signedIn()
      clock = NOW + 3600 * 1000
      respond = (call) =>
        call.url === TOKEN_URL
          ? json(tokenBody({ access_token: 'access-2', refresh_token: 'refresh-2' }))
          : new Response('', { status: 200 })
      calls.length = 0
      await Promise.all([service.test({ id }), service.test({ id }), service.test({ id })])
      expect(calls.filter((c) => c.url === TOKEN_URL)).toHaveLength(1)
    })

    it('a terminal refresh error clears the tokens, keeps the client id and flags re-auth', async () => {
      const { service, box, id } = await signedIn()
      clock = NOW + 3600 * 1000
      respond = (call) =>
        call.url === TOKEN_URL
          ? json({ error: 'refresh_token_reused' }, 400)
          : new Response('', { status: 200 })
      const result = await service.test({ id })
      expect(result).toEqual({ ok: false, reason: 'invalid_key' })
      const [pub] = await service.list()
      expect(pub?.reauthRequired).toBe(true)
      const [row] = await db.select().from(providerCredentials)
      const blob = parseStoredCredential(
        box.decrypt(row?.secretEnc as Uint8Array, `provider_credentials:${id}`),
      )
      expect(blob).toMatchObject({
        clientId: CLIENT_ID,
        accessToken: null,
        refreshToken: null,
        idToken: null,
      })
      expect((await db.select().from(oauthClients)).map((c) => c.clientId)).toEqual([CLIENT_ID])
    })

    it('a late terminal refresh error cannot wipe the tokens of a newer sign-in', async () => {
      const { service, box, id } = await signedIn()
      clock = NOW + 3600 * 1000
      let release!: () => void
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const isRefresh = (c: Call) =>
        c.url === TOKEN_URL && new URLSearchParams(c.body).get('grant_type') === 'refresh_token'
      respond = async (call) => {
        if (isRefresh(call)) {
          await gate
          return json({ error: 'invalid_grant' }, 400)
        }
        if (call.url === TOKEN_URL) {
          return json(
            tokenBody({
              access_token: 'access-new',
              refresh_token: 'refresh-new',
              id_token: idTokenFor(call),
            }),
          )
        }
        return new Response('', { status: 200 })
      }
      const stale = service.test({ id })
      await vi.waitFor(() => expect(calls.some(isRefresh)).toBe(true))
      const reSignIn = signIn(service)
      // Give a lock-less persist the chance to run first; the fixed code makes it wait.
      await new Promise((resolve) => setTimeout(resolve, 100))
      release()
      await Promise.all([stale, reSignIn])
      const [row] = await db.select().from(providerCredentials)
      const blob = parseStoredCredential(
        box.decrypt(row?.secretEnc as Uint8Array, `provider_credentials:${id}`),
      )
      expect(blob).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' })
      expect(row?.reauthRequired).toBe(false)
    })

    it('createModel builds a Responses model that sends the stored bearer with store:false', async () => {
      const { service, id } = await signedIn()
      respond = () =>
        new Response('data: {"type":"response.completed","response":{"id":"r","usage":{}}}\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      calls.length = 0
      const model = await service.createModel(id, 'gpt-x')
      const { stream } = await model.doStream({
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      })
      await stream.cancel().catch(() => {})
      expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses')
      expect(calls[0]?.headers.get('authorization')).toBe('Bearer access-token-AAAA')
      expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({ store: false, stream: true })
    })

    it('logout revokes the refresh token, then deletes the row and keeps the client mapping', async () => {
      const { service, id } = await signedIn()
      calls.length = 0
      const removed = await service.delete(id)
      expect(removed.id).toBe(id)
      expect(removed.revoked).toBe(true)
      expect(calls).toHaveLength(1)
      expect(calls[0]?.url).toBe(REVOKE_URL)
      expect(Object.fromEntries(new URLSearchParams(calls[0]?.body))).toEqual({
        token: 'refresh-token-RRRR',
        token_type_hint: 'refresh_token',
        client_id: CLIENT_ID,
      })
      expect(await service.list()).toEqual([])
      expect((await db.select().from(oauthClients)).map((c) => c.clientId)).toEqual([CLIENT_ID])
    })

    it('logout retries a 5xx with a bound and still deletes when revocation never succeeds', async () => {
      const { service, id } = await signedIn()
      respond = () => new Response('', { status: 503 })
      calls.length = 0
      const removed = await service.delete(id)
      expect(removed.revoked).toBe(false)
      expect(calls.filter((c) => c.url === REVOKE_URL)).toHaveLength(3)
      expect(sleeps).toHaveLength(2)
      expect(await service.list()).toEqual([])
      expect(logLines.join('')).toContain('not confirmed')
    })

    it('logout of a credential whose tokens were already cleared skips the revoke call', async () => {
      const { service, id } = await signedIn()
      clock = NOW + 3600 * 1000
      respond = (call) =>
        call.url === TOKEN_URL
          ? json({ error: 'invalid_grant' }, 400)
          : new Response('', { status: 200 })
      await service.test({ id })
      calls.length = 0
      // Nothing left to revoke counts as done.
      expect((await service.delete(id)).revoked).toBe(true)
      expect(calls).toHaveLength(0)
      expect(await service.list()).toEqual([])
    })

    it('close() ends a pending attempt and its listener', async () => {
      const { service } = await signedIn()
      await service.startChatGptSignIn()
      await service.close()
      expect(listeners.last()?.closed).toBe(true)
    })

    it('does not log secrets while refreshing, revoking or failing', async () => {
      const { service, id } = await signedIn()
      clock = NOW + 3600 * 1000
      respond = (call) =>
        call.url === TOKEN_URL
          ? json({ error: 'refresh_token_reused' }, 400)
          : new Response('', { status: 200 })
      await service.test({ id })
      await service.delete(id)
      const text = logLines.join('')
      for (const secret of ['access-token-AAAA', 'refresh-token-RRRR', EMAIL]) {
        expect(text).not.toContain(secret)
      }
    })
  })
})
