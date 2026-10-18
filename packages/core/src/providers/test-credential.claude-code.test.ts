import { describe, expect, it, vi } from 'vitest'
import { testCredential } from './test-credential.ts'

const conn = { kind: 'anthropic_claude_code', baseUrl: null, secret: null } as const

describe('testCredential for anthropic_claude_code', () => {
  it('checks the login with the binary, never over HTTP', async () => {
    const fetch = vi.fn()
    const run = async () => ({
      stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }),
    })
    const res = await testCredential(conn, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      claudeCode: { run, resolveBinary: () => '/opt/claude' },
    })
    expect(res.ok).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports not signed in and wrong auth method as their own reasons', async () => {
    const answer = (authMethod: string) => async () => ({
      stdout: JSON.stringify({ loggedIn: authMethod !== 'none', authMethod }),
    })
    const claudeCode = { resolveBinary: () => '/opt/claude' }
    expect(
      await testCredential(conn, { claudeCode: { ...claudeCode, run: answer('none') } }),
    ).toEqual({
      ok: false,
      reason: 'not_signed_in',
    })
    expect(
      await testCredential(conn, { claudeCode: { ...claudeCode, run: answer('api_key') } }),
    ).toEqual({ ok: false, reason: 'wrong_auth_method' })
  })
})
