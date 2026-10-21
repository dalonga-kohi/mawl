import { describe, expect, it } from 'vitest'
import { scriptedFetch, sse } from './chatgpt/test-util.ts'
import type { TokenManager } from './chatgpt/token-manager.ts'
import { createLanguageModel } from './create-model.ts'
import { ProviderFailureError } from './failure.ts'

const tokens: TokenManager = {
  getAccessToken: async () => 'live-bearer',
  refreshAfterRejection: async () => 'live-bearer-2',
}

const conn = { kind: 'openai_chatgpt', baseUrl: null, secret: null } as const

const PROMPT = [
  { role: 'system' as const, content: 'You are Mawl.' },
  { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] },
]

describe('createLanguageModel for openai_chatgpt', () => {
  it('calls the Responses API at the fixed OpenAI base url with the live bearer', async () => {
    const net = scriptedFetch([
      sse({ type: 'response.completed', response: { id: 'r', usage: {} } }),
    ])
    const model = createLanguageModel(conn, 'gpt-x', { fetch: net.fetch, chatgpt: { tokens } })
    const { stream } = await model.doStream({ prompt: PROMPT })
    await stream.cancel().catch(() => {})
    expect(net.calls[0]?.url).toBe('https://api.openai.com/v1/responses')
    expect(net.calls[0]?.headers.get('authorization')).toBe('Bearer live-bearer')
    expect(net.calls[0]?.redirect).toBe('error')
  })

  it('sends store:false, stream:true, no system role, and none of the unsupported fields', async () => {
    const net = scriptedFetch([
      sse({ type: 'response.completed', response: { id: 'r', usage: {} } }),
    ])
    const model = createLanguageModel(conn, 'gpt-x', { fetch: net.fetch, chatgpt: { tokens } })
    const { stream } = await model.doStream({
      prompt: PROMPT,
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 100,
      providerOptions: {
        openai: {
          user: 'u',
          safetyIdentifier: 's',
          metadata: { a: 'b' },
          truncation: 'auto',
          store: true,
        },
      },
    })
    await stream.cancel().catch(() => {})
    const sent = JSON.parse(net.calls[0]?.body ?? '{}') as Record<string, unknown> & {
      input: Array<{ role?: string }>
    }
    expect(sent.store).toBe(false)
    expect(sent.stream).toBe(true)
    for (const k of [
      'temperature',
      'top_p',
      'max_output_tokens',
      'user',
      'safety_identifier',
      'metadata',
      'truncation',
      'previous_response_id',
    ]) {
      expect(sent, k).not.toHaveProperty(k)
    }
    expect(sent.input.some((i) => i.role === 'system')).toBe(false)
    expect(sent.input[0]?.role).toBe('developer')
  })

  it('refuses a non-streaming call with a typed error and sends nothing', async () => {
    const net = scriptedFetch([sse({ type: 'response.completed' })])
    const model = createLanguageModel(conn, 'gpt-x', { fetch: net.fetch, chatgpt: { tokens } })
    const err = await Promise.resolve(model.doGenerate({ prompt: PROMPT })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect(net.calls).toHaveLength(0)
  })

  it('needs a token manager: it never falls back to an API key from the environment', () => {
    expect(() => createLanguageModel(conn, 'gpt-x')).toThrow(/Sign in with ChatGPT/)
  })

  it('ignores a configured base url: the plan endpoint is fixed', async () => {
    const net = scriptedFetch([
      sse({ type: 'response.completed', response: { id: 'r', usage: {} } }),
    ])
    const model = createLanguageModel({ ...conn, baseUrl: 'https://evil.example/v1' }, 'gpt-x', {
      fetch: net.fetch,
      chatgpt: { tokens },
    })
    const { stream } = await model.doStream({ prompt: PROMPT })
    await stream.cancel().catch(() => {})
    expect(net.calls[0]?.url.startsWith('https://api.openai.com/v1/')).toBe(true)
  })
})
