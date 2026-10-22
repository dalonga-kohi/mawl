import { describe, expect, it } from 'vitest'
import { embeddedClaudeManifest } from './embedded-manifest.ts'

describe('embeddedClaudeManifest', () => {
  it('is undefined outside the production bundle', () => {
    expect(embeddedClaudeManifest()).toBeUndefined()
  })

  it('parses and validates the build-time JSON', () => {
    const json = JSON.stringify({
      version: '1.0.0',
      packages: {
        'win32-x64': { url: 'https://registry.example/x.tgz', integrity: 'sha512-AAAA' },
      },
    })
    expect(embeddedClaudeManifest(json)?.version).toBe('1.0.0')
  })

  it('refuses a plain-http tarball url or unknown fields', () => {
    const http = JSON.stringify({
      version: '1.0.0',
      packages: { 'win32-x64': { url: 'http://registry.example/x.tgz', integrity: 'sha512-AAAA' } },
    })
    expect(() => embeddedClaudeManifest(http)).toThrow()
    expect(() => embeddedClaudeManifest('{"version":"1","packages":{},"extra":1}')).toThrow()
  })
})
