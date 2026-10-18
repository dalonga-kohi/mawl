import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { createChatGptFetch } from './fetch.ts'
import { drain, json, scriptedFetch, sse } from './test-util.ts'
import type { TokenManager } from './token-manager.ts'

const URL_RESPONSES = 'https://api.openai.com/v1/responses'

function tokensOf(initial = 'bearer-1', next = 'bearer-2') {
  const refreshed: string[] = []
  const tokens: TokenManager = {
    getAccessToken: async () => initial,
    refreshAfterRejection: async (rejected) => {
      refreshed.push(rejected)
      return next
    },
  }
  return { tokens, refreshed }
}

const body = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ model: 'gpt-x', input: [], stream: true, ...over })

const post = (b: string, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: b,
})

const OK = () => sse({ type: 'response.completed', response: { id: 'r' } })

describe('chatgpt fetch wrapper: request', () => {
  it('injects the fresh bearer, replacing any placeholder, and forces redirect "error"', async () => {
    const net = scriptedFetch([OK()])
    const { tokens } = tokensOf()
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    await f(
      URL_RESPONSES,
      post(body(), { authorization: 'Bearer chatgpt-oauth', 'openai-organization': 'org-x' }),
    )
    expect(net.calls[0]?.headers.get('authorization')).toBe('Bearer bearer-1')
    expect(net.calls[0]?.headers.has('openai-organization')).toBe(false)
    expect(net.calls[0]?.redirect).toBe('error')
  })

  it('forces store:false and strips every unsupported field', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const unsupported = [
      'background',
      'conversation',
      'max_output_tokens',
      'max_tool_calls',
      'metadata',
      'moderation',
      'multi_agent',
      'prompt',
      'prompt_cache_retention',
      'safety_identifier',
      'temperature',
      'top_logprobs',
      'top_p',
      'truncation',
      'user',
      'previous_response_id',
    ]
    const extra = Object.fromEntries(unsupported.map((k) => [k, 'x']))
    await f(
      URL_RESPONSES,
      post(body({ ...extra, store: true, instructions: 'be kind', reasoning: { effort: 'low' } })),
    )
    const sent = JSON.parse(net.calls[0]?.body ?? '{}') as Record<string, unknown>
    expect(sent.store).toBe(false)
    expect(sent.stream).toBe(true)
    for (const k of unsupported) expect(sent, k).not.toHaveProperty(k)
    expect(sent).toMatchObject({
      model: 'gpt-x',
      instructions: 'be kind',
      reasoning: { effort: 'low' },
    })
  })

  it('sets store:false when the SDK left it out', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    await f(URL_RESPONSES, post(body()))
    expect(JSON.parse(net.calls[0]?.body ?? '{}').store).toBe(false)
  })

  it('sends no system role items: they become developer items', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const input = [
      { role: 'system', content: 'rules' },
      { role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
    ]
    await f(URL_RESPONSES, post(body({ input })))
    const sent = JSON.parse(net.calls[0]?.body ?? '{}') as { input: Array<{ role: string }> }
    expect(sent.input.map((i) => i.role)).toEqual(['developer', 'user'])
  })

  it.each([
    ['stream:false', body({ stream: false })],
    ['no stream flag', JSON.stringify({ model: 'm', input: [] })],
  ])('refuses a non-streaming call (%s) before any request', async (_n, b) => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const err = await f(URL_RESPONSES, post(b)).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect((err as ProviderFailureError).reason).toBe('unsupported_capability')
    expect(net.calls).toHaveLength(0)
  })

  it('refuses a body it cannot read as JSON', async () => {
    const net = scriptedFetch([OK()])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    await expect(f(URL_RESPONSES, post('not json'))).rejects.toMatchObject({
      reason: 'unsupported_capability',
    })
    expect(net.calls).toHaveLength(0)
  })

  it('adds the bearer to other calls (model list) and leaves them unrewritten', async () => {
    const net = scriptedFetch([json({ models: [] })])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    await f('https://api.openai.com/v1/models', { method: 'GET' })
    expect(net.calls[0]?.headers.get('authorization')).toBe('Bearer bearer-1')
    expect(net.calls[0]?.body).toBe('')
  })
})

describe('chatgpt fetch wrapper: errors', () => {
  it.each([
    ['subscription_sharing_usage_limit_exceeded', 429, 'plan_limit_reached'],
    ['subscription_sharing_user_not_eligible', 403, 'not_eligible'],
    ['subscription_sharing_usage_unavailable', 503, 'temporarily_unavailable'],
    ['subscription_sharing_user_unavailable', 503, 'temporarily_unavailable'],
    ['subscription_sharing_unsupported_capability', 400, 'unsupported_capability'],
    ['subscription_sharing_route_not_supported', 403, 'config_error'],
    ['chatpass_v2_scope_not_authorized', 403, 'config_error'],
    ['chatpass_v2_invalid_authorization_context', 403, 'config_error'],
  ] as const)('maps an http error with code %s to %s', async (code, status, reason) => {
    const net = scriptedFetch([
      json({ error: { code, message: 'prose with sk-SECRET' } }, status, { 'retry-after': '42' }),
    ])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const err = (await f(URL_RESPONSES, post(body())).catch(
      (e: unknown) => e,
    )) as ProviderFailureError
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect(err.reason).toBe(reason)
    expect(err.retryAfter).toBe(42)
    expect(err.message).not.toContain('SECRET')
  })

  it('falls back to the status for a body without a code (pre-stream admission)', async () => {
    const net = scriptedFetch([json({ detail: 'nope' }, 403)])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    await expect(f(URL_RESPONSES, post(body()))).rejects.toMatchObject({ reason: 'not_eligible' })
  })

  it('refreshes once and retries with the new bearer on 401 (invalid_user)', async () => {
    const net = scriptedFetch((_c, i) =>
      i === 0 ? json({ error: { code: 'subscription_sharing_invalid_user' } }, 401) : OK(),
    )
    const { tokens, refreshed } = tokensOf()
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    const res = await f(URL_RESPONSES, post(body()))
    expect(res.status).toBe(200)
    expect(refreshed).toEqual(['bearer-1'])
    expect(net.calls.map((c) => c.headers.get('authorization'))).toEqual([
      'Bearer bearer-1',
      'Bearer bearer-2',
    ])
    expect(net.calls[1]?.body).toBe(net.calls[0]?.body)
  })

  it('does not loop: a second 401 after a good refresh is a config error', async () => {
    const net = scriptedFetch([json({ error: { code: 'subscription_sharing_invalid_user' } }, 401)])
    const { tokens, refreshed } = tokensOf()
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    await expect(f(URL_RESPONSES, post(body()))).rejects.toMatchObject({ reason: 'config_error' })
    expect(refreshed).toHaveLength(1)
    expect(net.calls).toHaveLength(2)
  })

  it('reports reauth_required when the refresh itself fails terminally', async () => {
    const net = scriptedFetch([json({ error: { code: 'subscription_sharing_invalid_user' } }, 401)])
    const tokens: TokenManager = {
      getAccessToken: async () => 'bearer-1',
      refreshAfterRejection: async () => {
        throw new ProviderFailureError('reauth_required')
      },
    }
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    await expect(f(URL_RESPONSES, post(body()))).rejects.toMatchObject({
      reason: 'reauth_required',
    })
  })

  it('propagates a token failure (plan usage disabled) without any request', async () => {
    const net = scriptedFetch([OK()])
    const tokens: TokenManager = {
      getAccessToken: async () => {
        throw new ProviderFailureError('plan_usage_disabled')
      },
      refreshAfterRejection: async () => 'x',
    }
    const f = createChatGptFetch({ tokens, fetch: net.fetch })
    await expect(f(URL_RESPONSES, post(body()))).rejects.toMatchObject({
      reason: 'plan_usage_disabled',
    })
    expect(net.calls).toHaveLength(0)
  })
})

describe('chatgpt fetch wrapper: streamed failures', () => {
  it('passes a healthy stream through byte for byte', async () => {
    const events = [
      { type: 'response.output_text.delta', delta: 'hi' },
      { type: 'response.completed', response: { id: 'r' } },
    ]
    const net = scriptedFetch([sse(...events)])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const res = await f(URL_RESPONSES, post(body()))
    expect(await drain(res)).toBe(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''))
  })

  it.each([
    [
      'response.failed',
      {
        type: 'response.failed',
        response: { error: { code: 'subscription_sharing_usage_limit_exceeded', message: 'x' } },
      },
      'plan_limit_reached',
    ],
    [
      'error',
      { type: 'error', code: 'subscription_sharing_usage_unavailable', message: 'x' },
      'temporarily_unavailable',
    ],
    [
      'error with nested code',
      { type: 'error', error: { code: 'subscription_sharing_user_not_eligible' } },
      'not_eligible',
    ],
    [
      'response.failed with an unknown code',
      { type: 'response.failed', response: { error: { code: 'weird', message: 'sk-SECRET' } } },
      'provider_error',
    ],
  ])('turns a streamed %s event into a typed stream error', async (_n, event, reason) => {
    const net = scriptedFetch([sse({ type: 'response.created' }, event)])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const res = await f(URL_RESPONSES, post(body()))
    const err = (await drain(res).catch((e: unknown) => e)) as ProviderFailureError
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect(err.reason).toBe(reason)
    expect(err.message).not.toContain('SECRET')
  })

  it('detects an event split across chunks', async () => {
    const text = `data: ${JSON.stringify({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } })}\n\n`
    const enc = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode(text.slice(0, 30)))
        c.enqueue(enc.encode(text.slice(30)))
        c.close()
      },
    })
    const net = scriptedFetch([
      new Response(stream, { headers: { 'content-type': 'text/event-stream' } }),
    ])
    const f = createChatGptFetch({ tokens: tokensOf().tokens, fetch: net.fetch })
    const res = await f(URL_RESPONSES, post(body()))
    await expect(drain(res)).rejects.toMatchObject({ reason: 'plan_limit_reached' })
  })
})
