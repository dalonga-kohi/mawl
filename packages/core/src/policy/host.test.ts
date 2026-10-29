import { describe, expect, it } from 'vitest'
import { normalizeHost, urlHost } from './host.ts'

describe('urlHost', () => {
  it.each([
    ['https://example.com/a?b=1', 'example.com'],
    ['HTTPS://Example.COM./x', 'example.com'],
    ['http://example.com:8080/', 'example.com'],
    ['https://bücher.de/', 'xn--bcher-kva.de'],
    ['https://8.8.8.8/', '8.8.8.8'],
    ['https://[2606:4700:4700::1111]/', '[2606:4700:4700::1111]'],
  ])('reads %s as the public host %s', (url, host) => {
    expect(urlHost(url)).toEqual({ kind: 'public', host })
  })

  it.each([
    'http://127.0.0.1/',
    'http://localhost/',
    'http://localhost./',
    'http://LOCALHOST:7420/',
    'http://api.localhost/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://0x7f.1/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://0/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/',
    'http://192.168.1.1/',
    'http://172.16.0.5/',
    'http://100.100.100.200/',
    'http://[fe80::1]/',
    'http://[fd00::1]/',
    'http://router/',
    'http://intranet./',
    'http://printer.local/',
    'http://nas.lan/',
    'http://box.home.arpa/',
    'http://svc.internal/',
    'http://127.0.0.1.nip.io/',
    'http://app.localtest.me/',
  ])('refuses the local or private host in %s', (url) => {
    expect(urlHost(url).kind).toBe('local')
  })

  it.each([
    'not a url',
    'ftp://example.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://user@evil.com@127.0.0.1/',
    'http://user:pw@example.com/',
    'http://example.com@127.0.0.1/',
    '',
  ])('treats %s as invalid (or credentialed)', (url) => {
    expect(urlHost(url).kind).toBe('invalid')
  })
})

describe('normalizeHost', () => {
  it.each([
    ['Docs.Example.com', 'docs.example.com'],
    ['docs.example.com.', 'docs.example.com'],
    ['bücher.de', 'xn--bcher-kva.de'],
  ])('normalizes %s to %s', (raw, host) => {
    expect(normalizeHost(raw)).toBe(host)
  })

  it.each(['example.com:80', 'https://example.com', 'a/b', 'user@x.com', '*.example.com', ' '])(
    'rejects %s (hosts only, no port, scheme, path or wildcard)',
    (raw) => {
      expect(normalizeHost(raw)).toBeNull()
    },
  )
})
