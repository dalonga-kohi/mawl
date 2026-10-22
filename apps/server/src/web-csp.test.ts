import { describe, expect, it } from 'vitest'
import { webCsp } from './web-static.ts'

const directives = (csp: string) => csp.split('; ')
const directive = (csp: string, name: string) =>
  directives(csp).find((d) => d.startsWith(`${name} `))

describe('webCsp', () => {
  it('names each directive once and never allows eval, inline script, wildcards or http', () => {
    for (const host of [undefined, '127.0.0.1:47420', 'localhost:7420', '[::1]:7420']) {
      const csp = webCsp(host)
      const names = directives(csp).map((d) => d.split(' ')[0])
      expect(new Set(names).size, csp).toBe(names.length)
      expect(csp).not.toMatch(/unsafe-eval|unsafe-hashes|wasm-unsafe-eval|strict-dynamic/)
      expect(directive(csp, 'script-src')).toBe("script-src 'self'")
      expect(directive(csp, 'default-src')).toBe("default-src 'self'")
      expect(csp).not.toMatch(/(^|[ ;])\*/)
      expect(csp).not.toMatch(/ https?:/)
      expect(csp).not.toMatch(/ wss?:(?=[ ;]|$)/)
      // 'unsafe-inline' only ever on styles.
      const inline = directives(csp).filter((d) => d.includes("'unsafe-inline'"))
      expect(inline).toEqual(["style-src 'self' 'unsafe-inline'"])
    }
  })

  it('locks the directives that do not fall back to default-src', () => {
    const csp = webCsp('127.0.0.1:47420')
    expect(directive(csp, 'object-src')).toBe("object-src 'none'")
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'")
    expect(directive(csp, 'form-action')).toBe("form-action 'self'")
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'")
  })

  it('echoes only a plain host into connect-src', () => {
    const hostile = [
      'evil.com; script-src *',
      '127.0.0.1:47420 evil.com',
      '127.0.0.1:47420,evil.com',
      "x'",
      '127.0.0.1:47420\n',
      '127.0.0.1:47420\r\nSet-Cookie: a=b',
      'user@127.0.0.1:47420',
      'a:b:c',
      'host:123456',
      'ünïcode.test',
      '*.example.com',
      '',
      ' ',
      '127.0.0.1:',
      '[::1',
      'http://evil.com',
    ]
    for (const host of hostile) {
      const csp = webCsp(host)
      expect(directive(csp, 'connect-src'), JSON.stringify(host)).toBe("connect-src 'self'")
      expect(csp).not.toContain('evil')
      expect(csp).not.toMatch(/[\r\n]/)
    }
  })

  it('names the websocket on both schemes for a good host', () => {
    expect(directive(webCsp('127.0.0.1:47420'), 'connect-src')).toBe(
      "connect-src 'self' ws://127.0.0.1:47420 wss://127.0.0.1:47420",
    )
    expect(directive(webCsp('LocalHost'), 'connect-src')).toBe(
      "connect-src 'self' ws://LocalHost wss://LocalHost",
    )
  })
})
