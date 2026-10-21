import { describe, expect, it } from 'vitest'
import { checkOrigin } from './origin.ts'

const HOST = 'mawl.home.lan:7420'

describe('checkOrigin', () => {
  it.each([
    ['no Origin header (non-browser client)', undefined, HOST, []],
    ['same host as the request', 'http://mawl.home.lan:7420', HOST, []],
    ['same host, different case', 'http://MAWL.home.lan:7420', HOST, []],
    ['https on the same host', 'https://mawl.home.lan:7420', HOST, []],
    ['localhost with a dev port', 'http://localhost:5173', HOST, []],
    ['localhost over https', 'https://localhost:3000', HOST, []],
    ['localhost without a port', 'http://localhost', HOST, []],
    ['127.0.0.1', 'http://127.0.0.1:5173', HOST, []],
    ['ipv6 loopback', 'http://[::1]:5173', HOST, []],
    ['Tauri on macOS and Linux', 'tauri://localhost', HOST, []],
    ['Tauri on Windows (http)', 'http://tauri.localhost', HOST, []],
    ['Tauri on Windows (https)', 'https://tauri.localhost', HOST, []],
    [
      'an origin from MAWL_ALLOWED_ORIGINS',
      'https://mawl.example.com',
      HOST,
      ['https://mawl.example.com'],
    ],
    [
      'an allowed origin with a trailing slash in the list',
      'https://mawl.example.com',
      HOST,
      ['https://mawl.example.com/'],
    ],
  ])('allows %s', (_name, origin, host, allowed) => {
    expect(checkOrigin({ origin, host, allowed })).toEqual({ ok: true })
  })

  it.each([
    ['another site', 'https://evil.example', HOST, [], 'origin_not_allowed'],
    ['a look-alike of localhost', 'http://localhost.evil.example', HOST, [], 'origin_not_allowed'],
    [
      'localhost as a subdomain prefix',
      'http://evil-localhost:5173',
      HOST,
      [],
      'origin_not_allowed',
    ],
    [
      'userinfo that spoofs localhost',
      'http://localhost@evil.example',
      HOST,
      [],
      'origin_not_allowed',
    ],
    ['the opaque origin of a sandboxed page', 'null', HOST, [], 'origin_not_allowed'],
    ['a file page', 'file://', HOST, [], 'origin_not_allowed'],
    ['an unparsable origin', 'not a url', HOST, [], 'origin_malformed'],
    [
      'a different port on the same host name',
      'http://mawl.home.lan:9999',
      HOST,
      [],
      'origin_not_allowed',
    ],
    ['ftp on localhost', 'ftp://localhost', HOST, [], 'origin_not_allowed'],
    ['a similar tauri origin', 'tauri://evil', HOST, [], 'origin_not_allowed'],
    [
      'an origin missing from a non-empty allow list',
      'https://other.example',
      HOST,
      ['https://mawl.example.com'],
      'origin_not_allowed',
    ],
  ])('rejects %s', (_name, origin, host, allowed, reason) => {
    expect(checkOrigin({ origin, host, allowed })).toEqual({ ok: false, reason })
  })

  it('rejects a same-host origin when the request has no Host header', () => {
    expect(
      checkOrigin({ origin: 'http://mawl.home.lan:7420', host: undefined, allowed: [] }),
    ).toEqual({
      ok: false,
      reason: 'origin_not_allowed',
    })
  })
})
