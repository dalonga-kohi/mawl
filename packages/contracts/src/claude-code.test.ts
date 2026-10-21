import { describe, expect, it } from 'vitest'
import { ProviderCredentialInput, ProviderTestResult } from './entities'
import { ProviderKind } from './enums'

describe('anthropic_claude_code provider kind', () => {
  it('is part of ProviderKind', () => {
    expect(ProviderKind.options).toContain('anthropic_claude_code')
  })

  it('is created from a label alone', () => {
    const r = ProviderCredentialInput.safeParse({
      provider: 'anthropic_claude_code',
      label: 'My Claude plan',
    })
    expect(r.success).toBe(true)
  })

  it('rejects a secret: Mawl never accepts a Claude token', () => {
    const r = ProviderCredentialInput.safeParse({
      provider: 'anthropic_claude_code',
      label: 'x',
      secret: 'sk-ant-oat01-abc',
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('claude auth login')
  })

  it('rejects a base url', () => {
    const r = ProviderCredentialInput.safeParse({
      provider: 'anthropic_claude_code',
      label: 'x',
      baseUrl: 'https://proxy.example.com',
    })
    expect(r.success).toBe(false)
  })
})

describe('ProviderTestResult for the Claude subscription', () => {
  it('names the two sign-in outcomes', () => {
    for (const reason of ['not_signed_in', 'wrong_auth_method']) {
      expect(ProviderTestResult.safeParse({ ok: false, reason }).success).toBe(true)
    }
  })
})
