import { afterEach, describe, expect, it } from 'vitest'
import {
  __resetSecretValues,
  REDACT_KEY_ALLOW,
  REDACT_KEY_PARTS,
  redactDeep,
  registerSecretValue,
} from './redact.ts'

describe('redactDeep', () => {
  it('exposes the normalised key fragments and the allowlist', () => {
    for (const k of ['token', 'secret', 'password', 'apikey', 'cookie', 'dsn', 'databaseurl']) {
      expect(REDACT_KEY_PARTS).toContain(k)
    }
    expect(REDACT_KEY_ALLOW.has('inputtokens')).toBe(true)
  })

  it.each([
    'accessToken',
    'refresh_token',
    'x-api-key',
    'X-Api-Key',
    'set-cookie',
    'clientSecret',
    'secret_enc',
    'DATABASE_URL',
    'connectionString',
    'privateKey',
    'passwd',
    'sentryDsn',
    'Authorization',
  ])('redacts key %s', (key) => {
    expect(redactDeep({ [key]: 'LEAK-ME' })).toEqual({ [key]: '[Redacted]' })
  })

  it('keeps token counters and unrelated keys', () => {
    const usage = {
      inputTokens: 1,
      outputTokens: 2,
      cachedTokens: 3,
      reasoningTokens: 4,
      tokenCount: 5,
      name: 'ok',
    }
    expect(redactDeep({ usage })).toEqual({ usage })
  })

  it('scrubs userinfo from urls in string values', () => {
    const out = JSON.stringify(
      redactDeep({
        msg: 'connect postgres://mawl:pw123@db:5432/mawl failed; also https://u:p2@h/x',
      }),
    )
    expect(out).not.toContain('pw123')
    expect(out).not.toContain('p2@')
    expect(out).toContain('postgres://mawl:[Redacted]@db:5432/mawl')
  })

  it('scrubs bearer tokens and known api key prefixes in strings', () => {
    const out = JSON.stringify(
      redactDeep({
        a: 'Authorization failed for Bearer abc.DEF-123_x',
        b: 'key sk-ant-api03-ABCDEF123456 bad',
        c: 'key sk-or-v1-abcdef123456 bad',
        d: 'key sk-proj1234567890abcdef bad',
      }),
    )
    for (const leak of ['abc.DEF', 'ABCDEF123456', 'abcdef123456', 'proj1234567890']) {
      expect(out).not.toContain(leak)
    }
    expect(out).toContain('Bearer [Redacted]')
  })

  it('leaves ordinary text alone', () => {
    expect(redactDeep({ m: 'run 3 finished at https://example.com/a?b=c, skill-name sk' })).toEqual(
      {
        m: 'run 3 finished at https://example.com/a?b=c, skill-name sk',
      },
    )
  })

  it('removes a raw error password from message and stack', () => {
    const err = new Error('connect postgres://u:pw@h/db refused')
    const out = JSON.stringify(redactDeep({ err }))
    expect(out).not.toContain(':pw@')
    expect(out).toContain('refused')
  })

  it('redacts regardless of key case', () => {
    expect(redactDeep({ ApiKey: 'x', DATABASE_URL: 'y', Authorization: 'z', ok: 1 })).toEqual({
      ApiKey: '[Redacted]',
      DATABASE_URL: '[Redacted]',
      Authorization: '[Redacted]',
      ok: 1,
    })
  })

  it('walks arrays and nested objects', () => {
    expect(redactDeep({ a: [{ b: { password: 'x', keep: [1, { token: 't' }] } }] })).toEqual({
      a: [{ b: { password: '[Redacted]', keep: [1, { token: '[Redacted]' }] } }],
    })
  })

  it('does not mutate its input', () => {
    const input = { secret: 'x', n: { token: 'y' } }
    redactDeep(input)
    expect(input).toEqual({ secret: 'x', n: { token: 'y' } })
  })

  it('survives cycles', () => {
    const a: Record<string, unknown> = { name: 'a' }
    a.self = a
    a.password = 'x'
    const out = redactDeep(a) as Record<string, unknown>
    expect(out.password).toBe('[Redacted]')
    expect(out.self).toBe('[Circular]')
  })

  it('caps depth', () => {
    let deep: Record<string, unknown> = { password: 'x' }
    for (let i = 0; i < 50; i++) deep = { next: deep }
    expect(JSON.stringify(redactDeep(deep))).not.toContain('"x"')
  })

  it('keeps primitives and shares repeated (non-cyclic) references', () => {
    const shared = { token: 't', v: 1 }
    const out = redactDeep({ a: shared, b: shared, s: 'str', n: null }) as Record<string, unknown>
    expect(out.a).toEqual({ token: '[Redacted]', v: 1 })
    expect(out.b).toEqual({ token: '[Redacted]', v: 1 })
    expect(out.s).toBe('str')
    expect(out.n).toBeNull()
  })

  it('turns Error instances into plain objects with redacted extra fields', () => {
    const err = Object.assign(new Error('boom'), { password: 'x', code: 'E1' })
    const out = redactDeep({ err }) as { err: Record<string, unknown> }
    expect(out.err).toMatchObject({ message: 'boom', code: 'E1', password: '[Redacted]' })
  })
  it('scrubs a password that contains slashes and colons, up to the last @', () => {
    const out = JSON.stringify(redactDeep({ m: 'x postgres://u:pa/ss:w@host/db y' }))
    expect(out).not.toContain('pa/ss')
    expect(out).not.toContain(':w@')
    expect(out).toContain('postgres://u:[Redacted]@host/db y')
  })

  it('keeps urls whose @ is only in the path', () => {
    const text = 'see https://example.com/users/@me now'
    expect(redactDeep({ m: text })).toEqual({ m: text })
  })

  it('scrubs a long alphanumeric string without :// in linear time', () => {
    const big = 'a'.repeat(1_000_000)
    const started = performance.now()
    expect(redactDeep({ big })).toEqual({ big })
    expect(performance.now() - started).toBeLessThan(50)
  })
})

describe('registerSecretValue', () => {
  afterEach(() => __resetSecretValues())

  it('censors a registered value inside any string, at any depth', () => {
    const value = 'Reg-Value_0123456789abcdefghijklmnop'
    registerSecretValue(value)
    const out = JSON.stringify(redactDeep({ a: `pre ${value} post`, b: [{ c: value }] }))
    expect(out).not.toContain(value)
    expect(out).toContain('pre [Redacted] post')
  })

  it('refuses a value too short to censor safely', () => {
    expect(() => registerSecretValue('short')).toThrow(/at least/)
  })

  it('refuses a value JSON would escape, since log lines are scrubbed after serialising', () => {
    expect(() => registerSecretValue('has"quote-0123456789abc')).toThrow(/only/)
    expect(() => registerSecretValue('has\\slash-0123456789abc')).toThrow(/only/)
  })

  it('forgets values on reset', () => {
    const value = 'Reg-Value_0123456789abcdefghijklmnop'
    registerSecretValue(value)
    __resetSecretValues()
    expect(redactDeep(value)).toBe(value)
  })
})
