import { describe, expect, it } from 'vitest'
import {
  bearerToken,
  isAuthToken,
  protocolToken,
  tokenMatches,
  WS_PROTOCOL,
  WS_TOKEN_PREFIX,
} from './token.ts'

const TOKEN = 'a'.repeat(43)

describe('tokenMatches (constant time)', () => {
  it('accepts the exact token', () => {
    expect(tokenMatches(TOKEN, TOKEN)).toBe(true)
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['wrong, same length', `${'a'.repeat(42)}b`],
    ['a prefix', TOKEN.slice(0, 20)],
    ['longer', `${TOKEN}a`],
    ['different case', TOKEN.toUpperCase()],
  ])('rejects a %s token', (_name, presented) => {
    expect(tokenMatches(presented, TOKEN)).toBe(false)
  })
})

describe('isAuthToken', () => {
  it.each([TOKEN, 'A-z_0'.repeat(7), 'x'.repeat(512)])('accepts %s', (v) => {
    expect(isAuthToken(v)).toBe(true)
  })
  it.each(['', 'x'.repeat(31), 'x'.repeat(513), `${'x'.repeat(40)}=`, `${'x'.repeat(40)} `])(
    'rejects %j',
    (v) => {
      expect(isAuthToken(v)).toBe(false)
    },
  )
})

describe('bearerToken', () => {
  it('reads the token of a Bearer header, any scheme case', () => {
    expect(bearerToken(`Bearer ${TOKEN}`)).toBe(TOKEN)
    expect(bearerToken(`bearer ${TOKEN}`)).toBe(TOKEN)
  })
  it.each([undefined, '', 'Bearer', 'Bearer ', `Basic ${TOKEN}`, `Bearer ${TOKEN} extra`])(
    'returns undefined for %j',
    (header) => {
      expect(bearerToken(header)).toBeUndefined()
    },
  )
})

describe('protocolToken (WebSocket subprotocols)', () => {
  it('reads the token from the token subprotocol next to mawl.v1', () => {
    expect(protocolToken(`${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}${TOKEN}`)).toBe(TOKEN)
    expect(protocolToken(`${WS_TOKEN_PREFIX}${TOKEN},${WS_PROTOCOL}`)).toBe(TOKEN)
  })

  it('requires mawl.v1 to be offered too, so there is always a safe protocol to echo', () => {
    expect(protocolToken(`${WS_TOKEN_PREFIX}${TOKEN}`)).toBeUndefined()
  })

  it.each([
    undefined,
    '',
    WS_PROTOCOL,
    `${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}`,
    // Two token offers are ambiguous: refuse rather than pick one.
    `${WS_PROTOCOL}, ${WS_TOKEN_PREFIX}${TOKEN}, ${WS_TOKEN_PREFIX}${TOKEN}`,
  ])('returns undefined for %j', (header) => {
    expect(protocolToken(header)).toBeUndefined()
  })
})
