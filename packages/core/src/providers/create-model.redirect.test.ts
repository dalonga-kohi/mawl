import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLanguageModel } from './create-model.ts'
import type { ProviderConnection } from './descriptors.ts'

const KEY = 'sk-sec-SECRET-123'

const CONNECTIONS: ProviderConnection[] = [
  { kind: 'anthropic', baseUrl: null, secret: KEY },
  { kind: 'openai', baseUrl: null, secret: KEY },
  { kind: 'openrouter', baseUrl: null, secret: KEY },
  { kind: 'ollama', baseUrl: null, secret: KEY },
  { kind: 'openai_compatible', baseUrl: 'https://llm.example.com/v1', secret: KEY },
]

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

interface Call {
  url: string
  init: RequestInit
}

function recordingFetch() {
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response('{}', { status: 500 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

async function fire(conn: ProviderConnection, opts?: { fetch: typeof globalThis.fetch }) {
  const model = createLanguageModel(conn, 'm', opts)
  await Promise.resolve(model.doGenerate({ prompt: PROMPT })).catch(() => {})
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('createLanguageModel redirects', () => {
  it.each(CONNECTIONS)('$kind: an injected fetch sees redirect "error"', async (conn) => {
    const { fetch, calls } = recordingFetch()
    await fire(conn, { fetch })
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.init.redirect).toBe('error')
  })

  it.each(CONNECTIONS)('$kind: the default path wraps globalThis.fetch', async (conn) => {
    const { fetch, calls } = recordingFetch()
    vi.stubGlobal('fetch', fetch)
    await fire(conn)
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect(c.init.redirect).toBe('error')
  })

  it('keeps method, headers and body while forcing redirect "error"', async () => {
    const { fetch, calls } = recordingFetch()
    await fire(CONNECTIONS[0] as ProviderConnection, { fetch })
    expect(calls[0]?.init.method).toBe('POST')
    expect(new Headers(calls[0]?.init.headers).get('x-api-key')).toBe(KEY)
    expect(calls[0]?.init.body).toBeDefined()
  })
})
