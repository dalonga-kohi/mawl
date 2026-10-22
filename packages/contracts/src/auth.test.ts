import { describe, expect, it } from 'vitest'
import { AUTH_TOKEN_PATTERN, AUTH_WS_PROTOCOL, AUTH_WS_TOKEN_PREFIX, wsProtocols } from './auth'

const TOKEN = 'abcDEF012_-'.repeat(4)

describe('auth transport constants', () => {
  it('offers mawl.v1 first and the token as its own subprotocol', () => {
    expect(wsProtocols(TOKEN)).toEqual([AUTH_WS_PROTOCOL, `${AUTH_WS_TOKEN_PREFIX}${TOKEN}`])
  })

  it('accepts base64url tokens of 32-512 characters only', () => {
    expect(AUTH_TOKEN_PATTERN.test(TOKEN)).toBe(true)
    expect(AUTH_TOKEN_PATTERN.test('x'.repeat(31))).toBe(false)
    expect(AUTH_TOKEN_PATTERN.test('x'.repeat(513))).toBe(false)
    expect(AUTH_TOKEN_PATTERN.test(`${'x'.repeat(40)}=`)).toBe(false)
  })

  it('refuses to build subprotocols from something that is not a token', () => {
    expect(() => wsProtocols('short')).toThrow(/token/)
    expect(() => wsProtocols(`${'x'.repeat(40)}, evil`)).toThrow(/token/)
  })
})
