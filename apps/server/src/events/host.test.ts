import { describe, expect, it } from 'vitest'
import { checkHost } from './host.ts'

const policy = { bindHost: '192.168.1.5', allowedOrigins: ['https://mawl.example.com:8443'] }

describe('checkHost', () => {
  it.each([
    'localhost',
    'localhost:7420',
    'LOCALHOST:7420',
    'app.localhost:5173',
    '127.0.0.1',
    '127.0.0.1:7420',
    '[::1]:7420',
    '[::1]',
    '192.168.1.5:7420',
    'mawl.example.com:7420',
    'mawl.example.com',
  ])('accepts the Host %s', (host) => {
    expect(checkHost(host, policy)).toEqual({ ok: true })
  })

  it.each([
    ['a rebound public name', 'evil.example.com:7420'],
    ['a look-alike of localhost', 'localhost.evil.example:7420'],
    ['a name ending in localhost without a dot', 'evillocalhost:7420'],
    ['userinfo spoofing', 'localhost@evil.example'],
    ['a missing Host', undefined],
    ['an empty Host', ''],
    ['another private address', '10.0.0.9:7420'],
    ['an IPv4-mapped loopback', '[::ffff:127.0.0.1]:7420'],
    ['another 127.x address', '127.0.0.2:7420'],
    ['a trailing-dot localhost', 'localhost.:7420'],
    ['userinfo before localhost', 'user@localhost:7420'],
  ])('rejects %s', (_name, host) => {
    expect(checkHost(host, policy)).toEqual({ ok: false, reason: 'host_not_allowed' })
  })

  it('ignores a wildcard bind host: Host 0.0.0.0 is denied', () => {
    expect(checkHost('0.0.0.0:7420', { bindHost: '0.0.0.0', allowedOrigins: [] })).toEqual({
      ok: false,
      reason: 'host_not_allowed',
    })
  })

  it('accepts a bracketed IPv6 bind host', () => {
    expect(checkHost('[fd00::5]:7420', { bindHost: 'fd00::5', allowedOrigins: [] })).toEqual({
      ok: true,
    })
  })
})
