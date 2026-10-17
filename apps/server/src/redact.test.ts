import { describe, expect, it } from 'vitest'
import { REDACT_KEYS, redactDeep } from './redact.ts'

describe('redactDeep', () => {
  it('exposes the case-insensitive key set', () => {
    for (const k of [
      'secret',
      'apikey',
      'api_key',
      'token',
      'password',
      'secretenc',
      'secret_enc',
      'authorization',
      'cookie',
      'databaseurl',
      'database_url',
    ]) {
      expect(REDACT_KEYS.has(k), k).toBe(true)
    }
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
})
