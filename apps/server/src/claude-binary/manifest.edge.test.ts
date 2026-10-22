import { describe, expect, it } from 'vitest'
import { ClaudeBinaryManifest, parseLockfileManifest, platformKey } from './manifest.ts'

const entry = (key: string, ver: string, integrity = 'sha512-AAAA') =>
  `  '@anthropic-ai/claude-agent-sdk-${key}@${ver}':\n    resolution: {integrity: ${integrity}}\n    cpu: [x64]\n\n`
const lock = (...entries: string[]) => `lockfileVersion: '9.0'\n\npackages:\n\n${entries.join('')}`

describe('parseLockfileManifest odd shapes', () => {
  it('handles a prerelease version', () => {
    const m = parseLockfileManifest(lock(entry('win32-x64', '0.3.0-beta.1')))
    expect(m.version).toBe('0.3.0-beta.1')
    expect(m.packages['win32-x64']?.url).toContain('claude-agent-sdk-win32-x64-0.3.0-beta.1.tgz')
  })

  it('keys linux glibc and musl as separate packages', () => {
    const m = parseLockfileManifest(
      lock(
        entry('linux-x64', '1.0.0', 'sha512-GLIBC'),
        entry('linux-x64-musl', '1.0.0', 'sha512-MUSL'),
      ),
    )
    expect(m.packages['linux-x64']?.integrity).toBe('sha512-GLIBC')
    expect(m.packages['linux-x64-musl']?.integrity).toBe('sha512-MUSL')
  })

  it('ignores the sdk itself and non-platform packages with a similar name', () => {
    const text = lock(
      entry('win32-x64', '1.0.0'),
      "  '@anthropic-ai/claude-agent-sdk@1.0.0':\n    resolution: {integrity: sha512-SDK}\n\n",
      "  'claude-agent-sdk-win32-x64@1.0.0':\n    resolution: {integrity: sha512-EVIL}\n\n",
    )
    const m = parseLockfileManifest(text)
    expect(Object.keys(m.packages)).toEqual(['win32-x64'])
    expect(m.packages['win32-x64']?.integrity).toBe('sha512-AAAA')
  })

  it('does not take entries from snapshots: with a peer suffix', () => {
    const text = `${lock(entry('win32-x64', '1.0.0'))}snapshots:\n\n  '@anthropic-ai/claude-agent-sdk-win32-x64@1.0.0(zod@4.0.0)':\n    resolution: {integrity: sha512-EVIL}\n`
    expect(parseLockfileManifest(text).packages['win32-x64']?.integrity).toBe('sha512-AAAA')
  })

  it('rejects a lockfile entry without sha512 (sha1 only) rather than inventing one', () => {
    expect(() => parseLockfileManifest(lock(entry('win32-x64', '1.0.0', 'sha1-AAAA')))).toThrow()
  })

  it('still reads an entry whose resolution carries extra fields (tarball:)', () => {
    const text =
      "packages:\n\n  '@anthropic-ai/claude-agent-sdk-win32-x64@1.0.0':\n    resolution: {integrity: sha512-AAAA, tarball: https://mirror.example/x.tgz}\n"
    expect(parseLockfileManifest(text).packages['win32-x64']?.integrity).toBe('sha512-AAAA')
  })

  it('empty input throws', () => {
    expect(() => parseLockfileManifest('')).toThrow()
  })
})

describe('ClaudeBinaryManifest schema', () => {
  const ok = { url: 'https://registry.npmjs.org/x.tgz', integrity: 'sha512-AAAA' }
  it('refuses http, file and javascript urls', () => {
    for (const url of ['http://registry.npmjs.org/x.tgz', 'file:///etc/passwd', 'ftp://x/y']) {
      expect(
        ClaudeBinaryManifest.safeParse({ version: '1', packages: { k: { ...ok, url } } }).success,
        url,
      ).toBe(false)
    }
  })
  it('refuses unknown fields and a non-sha512 integrity', () => {
    expect(
      ClaudeBinaryManifest.safeParse({ version: '1', packages: { k: { ...ok, extra: 1 } } })
        .success,
    ).toBe(false)
    expect(
      ClaudeBinaryManifest.safeParse({
        version: '1',
        packages: { k: { ...ok, integrity: 'sha256-AAAA' } },
      }).success,
    ).toBe(false)
  })
  it('refuses an empty version', () => {
    expect(ClaudeBinaryManifest.safeParse({ version: '', packages: {} }).success).toBe(false)
  })
  it('refuses a version that could escape the install dir', () => {
    for (const version of ['../x', '..\\x', 'a/b', '1.0.0/..']) {
      expect(
        ClaudeBinaryManifest.safeParse({ version, packages: { k: ok } }).success,
        version,
      ).toBe(false)
    }
  })
})

describe('platformKey', () => {
  it('musl flag is ignored off linux and arch is checked first', () => {
    expect(platformKey('win32', 'x64', true)).toBe('win32-x64')
    expect(platformKey('darwin', 'x64', true)).toBe('darwin-x64')
    expect(platformKey('linux', 'ia32', false)).toBeNull()
    expect(platformKey('linux', 'x64', true)).toBe('linux-x64-musl')
    expect(platformKey('aix', 'arm64', false)).toBeNull()
  })
})
