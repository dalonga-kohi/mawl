import type { ProviderKind } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { testCredential } from './test-credential.ts'

const KEY = 'sk-test-SECRET-123'

interface Seen {
  url: string
  init: RequestInit
}

/** Fake fetch answering with a fixed status; records the request. Never touches the network. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Seen[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const status =
  (code: number, body = '') =>
  () =>
    new Response(body, { status: code })

describe('testCredential request shape', () => {
  const cases: Array<{
    kind: ProviderKind
    baseUrl: string | null
    secret: string | null
    url: string
    headers: Record<string, string>
  }> = [
    {
      kind: 'anthropic',
      baseUrl: null,
      secret: KEY,
      url: 'https://api.anthropic.com/v1/models',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    },
    {
      kind: 'openai',
      baseUrl: null,
      secret: KEY,
      url: 'https://api.openai.com/v1/models',
      headers: { authorization: `Bearer ${KEY}` },
    },
    {
      kind: 'openrouter',
      baseUrl: null,
      secret: KEY,
      url: 'https://openrouter.ai/api/v1/key',
      headers: { authorization: `Bearer ${KEY}` },
    },
    {
      kind: 'ollama',
      baseUrl: null,
      secret: null,
      url: 'http://localhost:11434/api/tags',
      headers: {},
    },
    {
      kind: 'openai_compatible',
      baseUrl: 'https://llm.example.com/v1/',
      secret: KEY,
      url: 'https://llm.example.com/v1/models',
      headers: { authorization: `Bearer ${KEY}` },
    },
    {
      kind: 'openai_compatible',
      baseUrl: 'http://127.0.0.1:8080/v1',
      secret: null,
      url: 'http://127.0.0.1:8080/v1/models',
      headers: {},
    },
  ]

  it.each(cases)('$kind: one GET to $url with exact headers, redirects refused', async (c) => {
    const { fetch, calls } = fakeFetch(status(200))
    await testCredential({ kind: c.kind, baseUrl: c.baseUrl, secret: c.secret }, { fetch })
    expect(calls).toHaveLength(1)
    const call = calls[0] as Seen
    expect(call.url).toBe(c.url)
    expect(call.init.method).toBe('GET')
    expect(call.init.redirect).toBe('error')
    expect(call.init.body).toBeUndefined()
    expect(call.init.signal).toBeInstanceOf(AbortSignal)
    expect(Object.fromEntries(new Headers(call.init.headers))).toEqual(c.headers)
  })

  it('uses a custom base url for a built-in kind', async () => {
    const { fetch, calls } = fakeFetch(status(200))
    await testCredential(
      { kind: 'openai', baseUrl: 'https://proxy.example.com/v1', secret: KEY },
      { fetch },
    )
    expect(calls[0]?.url).toBe('https://proxy.example.com/v1/models')
  })

  it('never puts the secret in the url', async () => {
    const { fetch, calls } = fakeFetch(status(200))
    await testCredential({ kind: 'anthropic', baseUrl: null, secret: KEY }, { fetch })
    expect(calls[0]?.url).not.toContain(KEY)
  })
})

describe('testCredential outcome mapping', () => {
  const run = (respond: () => Response | Promise<Response>) =>
    testCredential(
      { kind: 'openai', baseUrl: null, secret: KEY },
      { fetch: fakeFetch(respond).fetch },
    )

  it('maps 2xx to ok with the measured latency', async () => {
    const ticks = [100, 142]
    const result = await testCredential(
      { kind: 'openai', baseUrl: null, secret: KEY },
      { fetch: fakeFetch(status(200)).fetch, now: () => ticks.shift() ?? 0 },
    )
    expect(result).toEqual({ ok: true, latencyMs: 42 })
  })

  it.each([
    [401, 'invalid_key'],
    [403, 'invalid_key'],
    [429, 'rate_limited'],
    [500, 'unexpected_response'],
    [404, 'unexpected_response'],
    [302, 'unexpected_response'],
  ] as const)('maps HTTP %i to %s', async (code, reason) => {
    expect(await run(status(code))).toEqual({ ok: false, reason })
  })

  it('maps a network error to unreachable without echoing its message', async () => {
    const result = await run(() => {
      throw new TypeError(`fetch failed for key ${KEY}`)
    })
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('maps a refused redirect (fetch throws) to unreachable', async () => {
    const result = await run(() => {
      throw new TypeError('fetch failed: unexpected redirect')
    })
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('maps a timeout to unreachable', async () => {
    const hang = (async (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      })) as typeof globalThis.fetch
    const result = await testCredential(
      { kind: 'openai', baseUrl: null, secret: KEY },
      { fetch: hang, timeoutMs: 5 },
    )
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('maps an unparseable base url to unreachable without calling fetch', async () => {
    const { fetch, calls } = fakeFetch(status(200))
    const result = await testCredential(
      { kind: 'openai_compatible', baseUrl: 'not a url', secret: null },
      { fetch },
    )
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
    expect(calls).toHaveLength(0)
  })

  it('never surfaces a provider error body, even one that echoes the key', async () => {
    const result = await run(status(401, JSON.stringify({ error: `bad key ${KEY}` })))
    expect(result).toEqual({ ok: false, reason: 'invalid_key' })
    expect(JSON.stringify(result)).not.toContain(KEY)
  })

  it('does not read the response body', async () => {
    let read = false
    const res = new Response('ok', { status: 200 })
    for (const m of ['json', 'text', 'arrayBuffer', 'blob', 'formData'] as const) {
      Object.defineProperty(res, m, {
        value: () => {
          read = true
          return Promise.resolve()
        },
      })
    }
    await run(() => res)
    expect(read).toBe(false)
  })
})
