import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLockfileManifest, platformKey } from './manifest.ts'

const lockfile = readFileSync(new URL('../../../../pnpm-lock.yaml', import.meta.url), 'utf8')

const SAMPLE = `lockfileVersion: '9.0'

packages:

  '@anthropic-ai/claude-agent-sdk-linux-x64-musl@1.2.3':
    resolution: {integrity: sha512-AAAA+/==}
    cpu: [x64]

  '@anthropic-ai/claude-agent-sdk-win32-x64@1.2.3':
    resolution: {integrity: sha512-BBBB+/==}
    cpu: [x64]

  '@anthropic-ai/sdk@0.135.0':
    resolution: {integrity: sha512-CCCC}

snapshots:

  '@anthropic-ai/claude-agent-sdk-win32-x64@1.2.3':
    optional: true
`

describe('parseLockfileManifest', () => {
  it('reads the pinned version and a tarball url plus integrity per platform package', () => {
    const manifest = parseLockfileManifest(SAMPLE)
    expect(manifest.version).toBe('1.2.3')
    expect(manifest.packages['win32-x64']).toEqual({
      url: 'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-1.2.3.tgz',
      integrity: 'sha512-BBBB+/==',
    })
    expect(manifest.packages['linux-x64-musl']?.integrity).toBe('sha512-AAAA+/==')
    expect(Object.keys(manifest.packages).sort()).toEqual(['linux-x64-musl', 'win32-x64'])
  })

  it('reads CRLF lockfiles too', () => {
    const manifest = parseLockfileManifest(SAMPLE.replaceAll('\n', '\r\n'))
    expect(manifest.packages['win32-x64']?.integrity).toBe('sha512-BBBB+/==')
  })

  it('throws when the platform packages disagree on a version', () => {
    const mixed = SAMPLE.replace('musl@1.2.3', 'musl@1.2.4')
    expect(() => parseLockfileManifest(mixed)).toThrow(/one version/)
  })

  it('throws when the lockfile has no platform package', () => {
    expect(() => parseLockfileManifest("packages:\n\n  'left-pad@1.0.0':\n")).toThrow(
      /no @anthropic-ai\/claude-agent-sdk platform packages/,
    )
  })

  it('yields win32-x64 from the real pnpm-lock.yaml', () => {
    const manifest = parseLockfileManifest(lockfile)
    const win = manifest.packages['win32-x64']
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(win?.url).toBe(
      `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-${manifest.version}.tgz`,
    )
    expect(win?.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/)
    expect(Object.keys(manifest.packages)).toContain('linux-x64-musl')
  })
})

describe('platformKey', () => {
  it('maps node platform and arch to the SDK package suffix', () => {
    expect(platformKey('win32', 'x64', false)).toBe('win32-x64')
    expect(platformKey('darwin', 'arm64', false)).toBe('darwin-arm64')
    expect(platformKey('linux', 'x64', false)).toBe('linux-x64')
    expect(platformKey('linux', 'arm64', true)).toBe('linux-arm64-musl')
  })

  it('returns null for platforms the SDK does not ship', () => {
    expect(platformKey('freebsd', 'x64', false)).toBeNull()
    expect(platformKey('win32', 'ia32', false)).toBeNull()
  })
})
