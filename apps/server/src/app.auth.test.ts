import type { contract } from '@mawl/contracts'
import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { describe, expect, it } from 'vitest'
import { createApp, RPC_MAX_BODY_BYTES } from './app.ts'
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from './auth/token.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'

const TOKEN = 'T0ken_for-the-app-auth-tests-0123456789'
const hosts = { bindHost: '127.0.0.1', allowedOrigins: [] }

function setup() {
  const lines: string[] = []
  const app = createApp({
    logger: createLogger({
      level: 'debug',
      stream: { write: (chunk: string) => void lines.push(chunk) },
    }),
    version: '1.2.3',
    providers: unusedProviders,
    runs: unusedRuns,
    checkDb: async () => {},
    hosts,
    authToken: TOKEN,
  })
  const clientWith = (headers: Record<string, string>): ContractRouterClient<typeof contract> =>
    createORPCClient(
      new RPCLink({
        url: 'http://127.0.0.1:7420/rpc',
        headers: { host: '127.0.0.1:7420', ...headers },
        fetch: async (request) => app.request(request),
      }),
    )
  const post = (path: string, headers: Record<string, string>, body = '{}') =>
    app.request(`http://127.0.0.1:7420${path}`, {
      method: 'POST',
      headers: { host: '127.0.0.1:7420', 'content-type': 'application/json', ...headers },
      body,
    })
  return { app, lines, clientWith, post }
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e,
  )

describe('/rpc requires the auth token', () => {
  it('serves a call that carries the right Bearer token', async () => {
    const { clientWith } = setup()
    const rpc = clientWith({ authorization: `Bearer ${TOKEN}` })
    expect(await rpc.health.get()).toEqual({ ok: true, version: '1.2.3' })
  })

  it.each([
    ['no token', {}],
    ['a wrong token of the same length', { authorization: `Bearer ${TOKEN.replace('T', 'X')}` }],
    ['a shorter token', { authorization: `Bearer ${TOKEN.slice(0, 32)}` }],
    ['a longer token', { authorization: `Bearer ${TOKEN}x` }],
    ['another scheme', { authorization: `Basic ${TOKEN}` }],
    // The WebSocket transport's subprotocol is not a way in over HTTP.
    [
      'the token as a subprotocol',
      { 'sec-websocket-protocol': `${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}${TOKEN}` },
    ],
  ])('answers the same generic UNAUTHORIZED to %s', async (_name, headers) => {
    const { clientWith } = setup()
    const err = await failure(clientWith(headers).health.get())
    expect(err).toBeInstanceOf(ORPCError)
    expect(err).toMatchObject({ code: 'UNAUTHORIZED', status: 401, message: 'Unauthorized' })
    expect((err as ORPCError<string, unknown>).data).toBeUndefined()
  })

  it('never reads the token from the url', async () => {
    const { post } = setup()
    for (const q of [
      `?token=${TOKEN}`,
      `?authorization=Bearer%20${TOKEN}`,
      `?access_token=${TOKEN}`,
    ]) {
      expect((await post(`/rpc/health/get${q}`, {})).status).toBe(401)
    }
  })

  it('gives an unauthenticated caller the same response body whatever was wrong', async () => {
    const { post } = setup()
    const missing = await post('/rpc/profiles/list', {})
    const wrong = await post('/rpc/profiles/list', { authorization: `Bearer ${'x'.repeat(40)}` })
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(await missing.text()).toBe(await wrong.text())
  })

  it('checks the Host before the token, so a rebound name learns nothing', async () => {
    const { post } = setup()
    const res = await post('/rpc/health/get', {
      host: 'evil.example:7420',
      authorization: `Bearer ${TOKEN}`,
    })
    expect(res.status).toBe(403)
  })

  it('never logs the token, right or wrong', async () => {
    const { post, lines } = setup()
    await post('/rpc/health/get', { authorization: `Bearer ${TOKEN}` })
    await post('/rpc/health/get', { authorization: `Bearer ${TOKEN}zz` })
    await post(`/rpc/health/get?token=${TOKEN}`, {})
    const log = lines.join('')
    expect(log).toContain('"status":401')
    expect(log).not.toContain(TOKEN)
  })

  it('leaves /healthz public', async () => {
    const { app } = setup()
    expect((await app.request('http://127.0.0.1:7420/healthz')).status).toBe(200)
  })
})

describe('/rpc body size limit', () => {
  const auth = { authorization: `Bearer ${TOKEN}` }

  it('accepts a body at the limit', async () => {
    const { post } = setup()
    const body = JSON.stringify({ json: { pad: 'x'.repeat(RPC_MAX_BODY_BYTES - 30) } })
    expect(body.length).toBeLessThanOrEqual(RPC_MAX_BODY_BYTES)
    expect((await post('/rpc/health/get', auth, body)).status).toBe(200)
  })

  it('answers 413 PAYLOAD_TOO_LARGE to a declared length over the limit', async () => {
    const { post } = setup()
    const res = await post('/rpc/health/get', auth, 'x'.repeat(RPC_MAX_BODY_BYTES + 1))
    expect(res.status).toBe(413)
    expect(await res.text()).toContain('PAYLOAD_TOO_LARGE')
  })

  it('answers 413 to a chunked body that grows past the limit', async () => {
    const { app } = setup()
    const chunk = new Uint8Array(256 * 1024).fill(0x20)
    let sent = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > RPC_MAX_BODY_BYTES * 2) return controller.close()
        sent += chunk.length
        controller.enqueue(chunk)
      },
    })
    const res = await app.request('http://127.0.0.1:7420/rpc/health/get', {
      method: 'POST',
      headers: { host: '127.0.0.1:7420', 'content-type': 'application/json', ...auth },
      body: stream,
      // reason: undici needs duplex for a streamed request body; lib.dom's RequestInit lacks it.
      ...({ duplex: 'half' } as object),
    })
    expect(res.status).toBe(413)
  })

  it('rejects an unauthenticated oversized body with 401, before reading it', async () => {
    const { post } = setup()
    const res = await post('/rpc/health/get', {}, 'x'.repeat(RPC_MAX_BODY_BYTES + 1))
    expect(res.status).toBe(401)
  })
})
