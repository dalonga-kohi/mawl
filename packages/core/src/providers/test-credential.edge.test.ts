import { describe, expect, it } from 'vitest'
import { createLanguageModel } from './create-model.ts'
import { testCredential } from './test-credential.ts'

const KEY = 'sk-edge-SECRET-789'

function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return respond()
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

const openai = { kind: 'openai', baseUrl: null, secret: KEY } as const

describe('testCredential edge cases', () => {
  it('reports unreachable when fetch never settles and ignores the abort signal', async () => {
    const never = (() => new Promise<Response>(() => {})) as typeof globalThis.fetch
    const outcome = await Promise.race([
      testCredential(openai, { fetch: never, timeoutMs: 20 }),
      new Promise<'hung'>((resolve) => setTimeout(() => resolve('hung'), 500)),
    ])
    expect(outcome).toEqual({ ok: false, reason: 'unreachable' })
  })

  it('maps a non-Error rejection to unreachable', async () => {
    const { fetch } = fakeFetch(() => Promise.reject(KEY))
    expect(await testCredential(openai, { fetch })).toEqual({ ok: false, reason: 'unreachable' })
  })

  it.each([
    [199, 'unexpected_response'],
    [204, 'ok'],
    [299, 'ok'],
    [300, 'unexpected_response'],
    [400, 'unexpected_response'],
    [402, 'unexpected_response'],
    [503, 'unexpected_response'],
  ] as const)('maps HTTP %i to %s', async (code, expected) => {
    // 204 and 199 are not valid for Response with a body, so build without one.
    const { fetch } = fakeFetch(() => ({ status: code, body: null }) as unknown as Response)
    const result = await testCredential(openai, { fetch, now: () => 0 })
    if (expected === 'ok') expect(result).toEqual({ ok: true, latencyMs: 0 })
    else expect(result).toEqual({ ok: false, reason: expected })
  })

  it('clamps a backwards clock to zero latency', async () => {
    const ticks = [500, 100]
    const { fetch } = fakeFetch(() => new Response('', { status: 200 }))
    const result = await testCredential(openai, { fetch, now: () => ticks.shift() ?? 0 })
    expect(result).toEqual({ ok: true, latencyMs: 0 })
  })

  it('does not throw when the response body cannot be cancelled', async () => {
    const res = new Response('x', { status: 200 })
    Object.defineProperty(res, 'body', {
      value: { cancel: () => Promise.reject(new Error('locked')) },
    })
    const { fetch } = fakeFetch(() => res)
    expect(await testCredential(openai, { fetch })).toMatchObject({ ok: true })
  })

  it.each([
    ['https://llm.example.com/v1//', 'https://llm.example.com/v1/models'],
    ['https://llm.example.com/', 'https://llm.example.com/models'],
    ['https://llm.example.com/a/b/c', 'https://llm.example.com/a/b/c/models'],
    ['http://[::1]:8080/v1/', 'http://[::1]:8080/v1/models'],
  ])('base url %s builds %s without double slashes', async (baseUrl, url) => {
    const { fetch, calls } = fakeFetch(() => new Response('', { status: 200 }))
    await testCredential({ kind: 'openai_compatible', baseUrl, secret: null }, { fetch })
    expect(calls[0]?.url).toBe(url)
  })

  it('openai_compatible without a base url never calls fetch', async () => {
    const { fetch, calls } = fakeFetch(() => new Response('', { status: 200 }))
    const result = await testCredential(
      { kind: 'openai_compatible', baseUrl: null, secret: KEY },
      { fetch },
    )
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
    expect(calls).toHaveLength(0)
  })

  it('ollama with a secret sends a bearer header, without one sends none', async () => {
    const withKey = fakeFetch(() => new Response('', { status: 200 }))
    await testCredential({ kind: 'ollama', baseUrl: null, secret: KEY }, { fetch: withKey.fetch })
    expect(new Headers(withKey.calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${KEY}`)
    const noKey = fakeFetch(() => new Response('', { status: 200 }))
    await testCredential({ kind: 'ollama', baseUrl: null, secret: null }, { fetch: noKey.fetch })
    expect(new Headers(noKey.calls[0]?.init.headers).get('authorization')).toBeNull()
  })

  it('handles unicode and very long secrets in headers without leaking them in the result', async () => {
    const long = 'k'.repeat(4096)
    const { fetch, calls } = fakeFetch(() => new Response('', { status: 401 }))
    const result = await testCredential({ ...openai, secret: long }, { fetch })
    expect(result).toEqual({ ok: false, reason: 'invalid_key' })
    expect(new Headers(calls[0]?.init.headers).get('authorization')).toBe(`Bearer ${long}`)
  })

  it('a non-latin1 secret makes header construction fail and maps to unreachable, not a throw', async () => {
    const { fetch } = fakeFetch(() => new Response('', { status: 200 }))
    // Real fetch rejects such headers; the fake uses new Headers() below to mimic it.
    const strict = (async (u: string | URL | Request, init?: RequestInit) => {
      new Headers(init?.headers)
      return fetch(u, init)
    }) as typeof globalThis.fetch
    const result = await testCredential({ ...openai, secret: 'ключ-🔑' }, { fetch: strict })
    expect(result).toEqual({ ok: false, reason: 'unreachable' })
  })
})

describe('createLanguageModel construction', () => {
  it.each([
    { kind: 'anthropic', baseUrl: null, secret: KEY },
    { kind: 'openai', baseUrl: null, secret: KEY },
    { kind: 'openrouter', baseUrl: null, secret: KEY },
    { kind: 'ollama', baseUrl: null, secret: null },
    { kind: 'openai_compatible', baseUrl: 'https://llm.example.com/v1/', secret: null },
  ] as const)('$kind: v4 model, no network call at construction', (conn) => {
    let called = 0
    const fetch = (async () => {
      called++
      return new Response('{}')
    }) as unknown as typeof globalThis.fetch
    const model = createLanguageModel(conn, 'm', { fetch })
    expect(model.specificationVersion).toBe('v4')
    expect(called).toBe(0)
  })

  it('treats an empty-string secret as no key for key-requiring kinds', () => {
    expect(() => createLanguageModel({ kind: 'openai', baseUrl: null, secret: '' }, 'm')).toThrow(
      /API key/,
    )
  })
})
