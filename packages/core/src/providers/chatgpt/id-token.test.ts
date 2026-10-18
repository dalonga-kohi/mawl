import { createLocalJWKSet, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { IdTokenError, verifyIdToken } from './id-token.ts'
import { CLIENT_ID, ID_KEYS, makeIdToken, WRONG_KEYS } from './test-util.ts'

const NOW = 1_800_000_000_000
const good = {
  iss: 'https://auth.openai.com',
  aud: CLIENT_ID,
  exp: NOW / 1000 + 600,
  nonce: 'n0nce',
  sub: 'user-sub-1',
  email: 'owner@example.com',
}
const checks = { clientId: CLIENT_ID, nonce: 'n0nce', now: NOW, keys: ID_KEYS }
const check = (claims: Record<string, unknown>, over: Partial<typeof checks> = {}) =>
  verifyIdToken(makeIdToken(claims), { ...checks, ...over })

const failure = async (p: Promise<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(IdTokenError)
  return err as IdTokenError
}

describe('verifyIdToken', () => {
  it('returns the subject and email of a valid, signed token', async () => {
    expect(await check(good)).toEqual({ subject: 'user-sub-1', email: 'owner@example.com' })
  })

  it('accepts an audience list that contains the client id, and a missing email', async () => {
    const { email: _email, ...noEmail } = good
    expect(await check({ ...noEmail, aud: ['other', CLIENT_ID] })).toEqual({
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
  ])('rejects a wrong %s', async (_name, over) => {
    await failure(check({ ...good, ...over }))
  })

  it('rejects a token signed by a key OpenAI does not publish', async () => {
    const err = await failure(verifyIdToken(makeIdToken(good, true), checks))
    expect(err.check).toBe('signature')
  })

  it('rejects a valid token when the key set does not hold its key', async () => {
    expect((await failure(check(good, { keys: WRONG_KEYS }))).check).toBe('signature')
  })

  it('rejects an unsigned (alg none) token', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
    const unsigned = `${b64({ alg: 'none' })}.${b64(good)}.`
    expect((await failure(verifyIdToken(unsigned, checks))).check).toBe('signature')
  })

  it('rejects an algorithm outside the allow-list even with a matching secret key set', async () => {
    const secret = new TextEncoder().encode('x'.repeat(32))
    const hs = await new SignJWT(good).setProtectedHeader({ alg: 'HS256', kid: 'k1' }).sign(secret)
    const keys = createLocalJWKSet({
      keys: [{ kty: 'oct', k: Buffer.from(secret).toString('base64url'), kid: 'k1', alg: 'HS256' }],
    })
    expect((await failure(verifyIdToken(hs, { ...checks, keys }))).check).toBe('signature')
  })

  it('fails closed when the key set cannot be fetched', async () => {
    const keys = (async () => {
      throw new Error('network down')
    }) as unknown as typeof ID_KEYS
    expect((await failure(check(good, { keys }))).check).toBe('signature')
  })

  it('rejects a token that is not a JWT or whose payload is not JSON', async () => {
    const run = (t: string) => verifyIdToken(t, checks)
    await failure(run('nope'))
    await failure(run('a.@@@.c'))
  })

  it('never puts token content in the error message', async () => {
    const err = await failure(check({ ...good, nonce: 'secret-nonce-value' }))
    expect(err.message).not.toContain('secret-nonce-value')
  })
})
