import { describe, expect, it } from 'vitest'
import { scriptedFetch } from './chatgpt/test-util.ts'
import { testCredential } from './test-credential.ts'

describe('testCredential for openai_chatgpt', () => {
  it('lists models with the access token as bearer, at the fixed base url', async () => {
    const net = scriptedFetch([new Response('{}', { status: 200 })])
    const result = await testCredential(
      { kind: 'openai_chatgpt', baseUrl: 'https://evil.example/v1', secret: 'access-AAA' },
      { fetch: net.fetch },
    )
    expect(result.ok).toBe(true)
    expect(net.calls[0]?.url).toBe('https://api.openai.com/v1/models')
    expect(net.calls[0]?.headers.get('authorization')).toBe('Bearer access-AAA')
    expect(net.calls[0]?.redirect).toBe('error')
  })

  it('reports a rejected token as invalid_key', async () => {
    const net = scriptedFetch([new Response('{}', { status: 401 })])
    const result = await testCredential(
      { kind: 'openai_chatgpt', baseUrl: null, secret: 'access-AAA' },
      { fetch: net.fetch },
    )
    expect(result).toEqual({ ok: false, reason: 'invalid_key' })
  })
})
