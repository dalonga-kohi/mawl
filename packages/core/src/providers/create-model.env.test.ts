import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLanguageModel } from './create-model.ts'
import type { ProviderConnection } from './descriptors.ts'

const PROMPT = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

const ENV = {
  OPENAI_API_KEY: 'sk-env-leak',
  OPENROUTER_API_KEY: 'sk-env-leak',
  ANTHROPIC_API_KEY: 'sk-env-leak',
  OLLAMA_API_KEY: 'sk-env-leak',
  OPENAI_COMPATIBLE_API_KEY: 'sk-env-leak',
}

function recordingFetch() {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} })
    return new Response('{}', { status: 500 })
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createLanguageModel env key fallback', () => {
  it.each([
    { kind: 'ollama', baseUrl: null, secret: null },
    { kind: 'openai_compatible', baseUrl: 'https://llm.example.com/v1', secret: null },
  ] as const satisfies ProviderConnection[])(
    '$kind without a key sends no credential header',
    async (conn) => {
      for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
      const { fetch, calls } = recordingFetch()
      await Promise.resolve(
        createLanguageModel(conn, 'm', { fetch }).doGenerate({ prompt: PROMPT }),
      ).catch(() => {})
      expect(calls.length).toBeGreaterThan(0)
      for (const c of calls) {
        const h = new Headers(c.init.headers)
        expect(h.get('authorization')).toBeNull()
        expect(h.get('x-api-key')).toBeNull()
        expect(JSON.stringify([...h.entries()])).not.toContain('sk-env-leak')
      }
    },
  )

  it.each(['anthropic', 'openai', 'openrouter'] as const)(
    '%s without a key throws instead of reading the env var',
    (kind) => {
      for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v)
      expect(() => createLanguageModel({ kind, baseUrl: null, secret: null }, 'm')).toThrow(
        /API key/,
      )
    },
  )
})
