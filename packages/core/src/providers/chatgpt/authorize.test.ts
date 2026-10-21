import { describe, expect, it } from 'vitest'
import { buildAuthorizeUrl, redirectUri } from './authorize.ts'
import { CLIENT_ID, HOST_ID } from './test-util.ts'

const base = {
  hostId: HOST_ID,
  redirectUri: redirectUri(1455),
  state: 'st4te',
  nonce: 'n0nce',
  challenge: 'chal',
}

describe('redirectUri', () => {
  it('is a 127.0.0.1 loopback with the callback path, never localhost', () => {
    expect(redirectUri(1455)).toBe('http://127.0.0.1:1455/auth/callback')
    expect(redirectUri(8123)).toBe('http://127.0.0.1:8123/auth/callback')
  })
})

describe('buildAuthorizeUrl', () => {
  it('sends every documented parameter on first registration', () => {
    const url = new URL(buildAuthorizeUrl({ ...base, clientId: null }))
    expect(`${url.origin}${url.pathname}`).toBe('https://auth.openai.com/api/accounts/authorize')
    const p = url.searchParams
    expect(p.get('client_id')).toBe('dynamic_agent_client')
    expect(p.get('agent_name_hint')).toBe('Mawl')
    expect(p.get('ext_agent_host_id')).toBe(HOST_ID)
    expect(p.get('response_type')).toBe('code')
    expect(p.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback')
    expect(p.get('scope')).toBe(
      'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    )
    expect(p.get('resource')).toBe('https://api.openai.com/v1')
    expect(p.get('state')).toBe('st4te')
    expect(p.get('nonce')).toBe('n0nce')
    expect(p.get('code_challenge_method')).toBe('S256')
    expect(p.get('code_challenge')).toBe('chal')
  })

  it('reuses the issued client id and drops the registration-only hint', () => {
    const p = new URL(buildAuthorizeUrl({ ...base, clientId: CLIENT_ID })).searchParams
    expect(p.get('client_id')).toBe(CLIENT_ID)
    expect(p.has('agent_name_hint')).toBe(false)
  })

  it('refuses an issued client id that is the dynamic placeholder', () => {
    expect(() => buildAuthorizeUrl({ ...base, clientId: 'dynamic_agent_client' })).toThrow()
  })

  it('refuses a localhost redirect', () => {
    expect(() =>
      buildAuthorizeUrl({
        ...base,
        clientId: null,
        redirectUri: 'http://localhost:1455/auth/callback',
      }),
    ).toThrow()
  })
})
