import { describe, expect, it } from 'vitest'
import { IdTokenError, verifyIdToken } from './id-token.ts'
import { CLIENT_ID, makeIdToken } from './test-util.ts'

const NOW = 1_800_000_000_000
const good = {
  iss: 'https://auth.openai.com',
  aud: CLIENT_ID,
  exp: NOW / 1000 + 600,
  nonce: 'n0nce',
  sub: 'user-sub-1',
  email: 'owner@example.com',
}
const check = (claims: Record<string, unknown>, over: { nonce?: string; clientId?: string } = {}) =>
  verifyIdToken(makeIdToken(claims), {
    clientId: over.clientId ?? CLIENT_ID,
    nonce: over.nonce ?? 'n0nce',
    now: NOW,
  })

describe('verifyIdToken', () => {
  it('returns the subject and email of a valid token', () => {
    expect(check(good)).toEqual({ subject: 'user-sub-1', email: 'owner@example.com' })
  })

  it('accepts an audience list that contains the client id, and a missing email', () => {
    const { email: _email, ...noEmail } = good
    expect(check({ ...noEmail, aud: ['other', CLIENT_ID] })).toEqual({
      subject: 'user-sub-1',
      email: null,
    })
  })

  it.each([
    ['issuer', { iss: 'https://evil.example' }],
    ['audience', { aud: 'oaiapp_other' }],
    ['audience list without the client', { aud: ['a', 'b'] }],
    ['expiry', { exp: NOW / 1000 - 1 }],
    ['nonce', { nonce: 'other' }],
    ['missing nonce', { nonce: undefined }],
    ['missing subject', { sub: undefined }],
  ])('rejects a wrong %s', (_name, over) => {
    expect(() => check({ ...good, ...over })).toThrow(IdTokenError)
  })

  it('rejects a token that is not a JWT or whose payload is not JSON', () => {
    const run = (t: string) => verifyIdToken(t, { clientId: CLIENT_ID, nonce: 'n0nce', now: NOW })
    expect(() => run('nope')).toThrow(IdTokenError)
    expect(() => run('a.@@@.c')).toThrow(IdTokenError)
  })

  it('never puts token content in the error message', () => {
    try {
      check({ ...good, nonce: 'secret-nonce-value' })
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('secret-nonce-value')
    }
  })
})
