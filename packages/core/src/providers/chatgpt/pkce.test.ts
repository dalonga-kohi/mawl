import { describe, expect, it } from 'vitest'
import { codeChallenge, createPkce } from './pkce.ts'

describe('PKCE', () => {
  it('matches the RFC 7636 appendix B vector (S256, base64url, no padding)', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })

  it('builds a 43 char url-safe verifier from 32 injected random bytes', () => {
    const { verifier, challenge } = createPkce(() => new Uint8Array(32).fill(7))
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toBe(codeChallenge(verifier))
    expect(challenge).not.toContain('=')
  })
})
