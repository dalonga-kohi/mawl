import type { ProviderKind } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { createLanguageModel } from './create-model.ts'

const KEY = 'sk-model-SECRET-456'

/** Fake fetch that records the request and answers 500; the model call then rejects. */
function recorder() {
  const seen: Array<{ url: string; headers: Headers }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(input), headers: new Headers(init?.headers) })
    return new Response('{}', { status: 500 })
  }) as typeof globalThis.fetch
  return { fetch, seen }
}

const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

const cases: Array<{
  kind: ProviderKind
  baseUrl: string | null
  secret: string | null
  url: string
  auth: Record<string, string>
}> = [
  {
    kind: 'anthropic',
    baseUrl: null,
    secret: KEY,
    url: 'https://api.anthropic.com/v1/messages',
    auth: { 'x-api-key': KEY },
  },
  {
    kind: 'openai',
    baseUrl: null,
    secret: KEY,
    url: 'https://api.openai.com/v1/responses',
    auth: { authorization: `Bearer ${KEY}` },
  },
  {
    kind: 'openrouter',
    baseUrl: null,
    secret: KEY,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    auth: { authorization: `Bearer ${KEY}` },
  },
  {
    kind: 'ollama',
    baseUrl: 'http://host.docker.internal:11434/',
    secret: null,
    url: 'http://host.docker.internal:11434/api/chat',
    auth: {},
  },
  {
    kind: 'openai_compatible',
    baseUrl: 'https://llm.example.com/v1',
    secret: KEY,
    url: 'https://llm.example.com/v1/chat/completions',
    auth: { authorization: `Bearer ${KEY}` },
  },
]

describe('createLanguageModel', () => {
  it.each(cases)('$kind: builds a v4 model that calls $url', async (c) => {
    const { fetch, seen } = recorder()
    const model = createLanguageModel(
      { kind: c.kind, baseUrl: c.baseUrl, secret: c.secret },
      'some-model',
      { fetch },
    )
    expect(model.specificationVersion).toBe('v4')
    expect(model.modelId).toBe('some-model')

    await Promise.resolve(model.doGenerate({ prompt })).catch(() => undefined)

    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(c.url)
    for (const [name, value] of Object.entries(c.auth)) {
      expect(seen[0]?.headers.get(name)).toBe(value)
    }
  })

  it('sends no auth header for openai_compatible without a secret', async () => {
    const { fetch, seen } = recorder()
    const model = createLanguageModel(
      { kind: 'openai_compatible', baseUrl: 'http://localhost:8080/v1', secret: null },
      'm',
      { fetch },
    )
    await Promise.resolve(model.doGenerate({ prompt })).catch(() => undefined)
    expect(seen[0]?.headers.get('authorization')).toBeNull()
  })

  it('refuses a key-requiring kind without a key instead of reading an env var', () => {
    for (const kind of ['anthropic', 'openai', 'openrouter'] as const) {
      expect(() => createLanguageModel({ kind, baseUrl: null, secret: null }, 'm')).toThrow(
        /API key/,
      )
    }
  })

  it('rejects openai_compatible without a base url', () => {
    expect(() =>
      createLanguageModel({ kind: 'openai_compatible', baseUrl: null, secret: null }, 'm'),
    ).toThrow(/base url/)
  })
})
