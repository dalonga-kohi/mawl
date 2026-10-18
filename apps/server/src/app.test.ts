import type { contract } from '@faire/contracts'
import { createORPCClient, ORPCError } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { describe, expect, it, vi } from 'vitest'
import { type AppDeps, createApp } from './app.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'

function setup(overrides: Partial<AppDeps> = {}) {
  const lines: string[] = []
  const logger = createLogger({
    level: 'info',
    stream: { write: (chunk: string) => void lines.push(chunk) },
  })
  const app = createApp({
    logger,
    version: '1.2.3',
    providers: unusedProviders,
    runs: unusedRuns,
    checkDb: async () => {},
    healthTimeoutMs: 50,
    ...overrides,
  })
  const client: ContractRouterClient<typeof contract> = createORPCClient(
    new RPCLink({ url: 'http://faire.test/rpc', fetch: async (request) => app.request(request) }),
  )
  return {
    app,
    client,
    lines,
    logs: () => lines.map((l) => JSON.parse(l) as Record<string, unknown>),
  }
}

describe('GET /healthz', () => {
  it('returns 200 { ok: true } when the database answers', async () => {
    const { app } = setup()
    const res = await app.request('/healthz')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('returns 503 { ok: false } without detail when the check rejects', async () => {
    const { app } = setup({
      checkDb: async () => {
        throw new Error('password authentication failed for user faire s3cr3t')
      },
    })
    const res = await app.request('/healthz')
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('{"ok":false}')
  })

  it('returns 503 when the check hangs past the timeout', async () => {
    const { app } = setup({ checkDb: () => new Promise(() => {}), healthTimeoutMs: 20 })
    const res = await app.request('/healthz')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false })
  })
})

describe('request logging', () => {
  it('logs method, path without query, status, duration and request id', async () => {
    const { app, logs } = setup()
    const res = await app.request('/healthz?token=LEAK-ME')
    const id = res.headers.get('x-request-id')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const entry = logs().find((l) => l.msg === 'request')
    expect(entry).toMatchObject({ method: 'GET', path: '/healthz', status: 200, requestId: id })
    expect(typeof entry?.durationMs).toBe('number')
    expect(JSON.stringify(logs())).not.toContain('LEAK-ME')
  })

  it('gives every request its own id', async () => {
    const { app } = setup()
    const a = (await app.request('/healthz')).headers.get('x-request-id')
    const b = (await app.request('/healthz')).headers.get('x-request-id')
    expect(a).not.toBe(b)
  })
})

describe('oRPC at /rpc', () => {
  it('serves health.get with the injected version', async () => {
    const { client } = setup()
    expect(await client.health.get()).toEqual({ ok: true, version: '1.2.3' })
  })

  it('answers every other contract procedure with 501 NOT_IMPLEMENTED', async () => {
    const { client } = setup()
    const err = await client.profiles.list().then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ORPCError)
    expect(err).toMatchObject({ code: 'NOT_IMPLEMENTED', status: 501 })
  })

  it('logs procedure path and error code only, never inputs', async () => {
    const { app, logs, lines } = setup()
    await app.request('/rpc/runs/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { prompt: 'LEAK-ME-INPUT' } }),
    })
    await app.request('/rpc/profiles/list', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ json: { includeArchived: true } }),
    })
    const rpcErrors = logs().filter((l) => l.msg === 'rpc error')
    expect(rpcErrors.length).toBeGreaterThan(0)
    expect(rpcErrors.find((l) => l.procedure === 'profiles.list')).toMatchObject({
      code: 'NOT_IMPLEMENTED',
    })
    expect(lines.join('')).not.toContain('LEAK-ME-INPUT')
  })

  it('does not match paths outside /rpc', async () => {
    const { app } = setup()
    expect((await app.request('/nope')).status).toBe(404)
    expect((await app.request('/rpcx/health/get', { method: 'POST' })).status).toBe(404)
  })
})

describe('deps', () => {
  it('never calls checkDb for rpc traffic', async () => {
    const checkDb = vi.fn(async () => {})
    const { client } = setup({ checkDb })
    await client.health.get()
    expect(checkDb).not.toHaveBeenCalled()
  })
})

describe('Host check on /rpc (DNS rebinding)', () => {
  const hosts = { bindHost: '127.0.0.1', allowedOrigins: ['https://faire.example.com'] }
  const call = (app: ReturnType<typeof setup>['app'], url: string) =>
    app.request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })

  it('answers 403 to a Host that is not ours', async () => {
    const { app } = setup({ hosts })
    const res = await call(app, 'http://evil.example:7420/rpc/health/get')
    expect(res.status).toBe(403)
  })

  it.each(['http://localhost:7420', 'http://127.0.0.1:7420', 'https://faire.example.com'])(
    'lets %s through',
    async (base) => {
      const { app } = setup({ hosts })
      const res = await call(app, `${base}/rpc/health/get`)
      expect(res.status).toBe(200)
    },
  )

  it('leaves /healthz open to any Host so probes keep working', async () => {
    const { app } = setup({ hosts })
    expect((await app.request('http://evil.example/healthz')).status).toBe(200)
  })
})
