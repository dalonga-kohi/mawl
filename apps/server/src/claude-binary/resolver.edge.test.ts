import { describe, expect, it, vi } from 'vitest'
import type { ClaudeBinaryManifest } from './manifest.ts'
import { createClaudeExecutableResolver } from './resolver.ts'

const manifest: ClaudeBinaryManifest = {
  version: '1.0.0',
  packages: { 'win32-x64': { url: 'https://registry.example/x.tgz', integrity: 'sha512-AAAA' } },
}
const logger = { info: vi.fn(), warn: vi.fn() }

describe('resolver precedence edges', () => {
  it('an empty explicit path (env set to "") falls through to the data dir', async () => {
    const ensure = vi.fn(async () => '/data/claude')
    const resolve = createClaudeExecutableResolver({
      explicitPath: '',
      dataDir: '/data',
      manifest,
      logger,
      ensure,
    })
    expect(await resolve()).toBe('/data/claude')
  })

  it('an explicit path wins even in headless mode with a bundled binary', async () => {
    const resolveBundled = vi.fn(() => '/bundled')
    const resolve = createClaudeExecutableResolver({
      explicitPath: '/mine',
      logger,
      resolveBundled,
    })
    expect(await resolve()).toBe('/mine')
    expect(resolveBundled).not.toHaveBeenCalled()
  })

  it('never falls back to the bundled package when the install fails (no silent downgrade)', async () => {
    const resolveBundled = vi.fn(() => '/bundled')
    const ensure = vi.fn(async () => {
      throw new Error('integrity')
    })
    const resolve = createClaudeExecutableResolver({
      dataDir: '/data',
      manifest,
      logger,
      ensure,
      resolveBundled,
    })
    await expect(resolve()).rejects.toThrow('integrity')
    expect(resolveBundled).not.toHaveBeenCalled()
  })

  it('dataDir without manifest and manifest without dataDir both skip the download', async () => {
    const ensure = vi.fn()
    for (const o of [{ dataDir: '/data' }, { manifest }]) {
      const resolve = createClaudeExecutableResolver({
        ...o,
        logger,
        ensure,
        resolveBundled: () => '/bundled',
      })
      expect(await resolve()).toBe('/bundled')
    }
    expect(ensure).not.toHaveBeenCalled()
  })

  it('passes the progress callback through and no signal key when none was given', async () => {
    const ensure = vi.fn(async () => '/p')
    const onProgress = vi.fn()
    await createClaudeExecutableResolver({ dataDir: '/d', manifest, logger, onProgress, ensure })()
    const arg = (ensure.mock.calls[0] as unknown as [Record<string, unknown>])[0]
    expect(arg.onProgress).toBe(onProgress)
    expect('signal' in arg).toBe(false)
  })

  it('calls ensure per invocation (the ensure layer dedupes), not once at creation', async () => {
    const ensure = vi.fn(async () => '/p')
    const resolve = createClaudeExecutableResolver({ dataDir: '/d', manifest, logger, ensure })
    await resolve()
    await resolve()
    expect(ensure).toHaveBeenCalledTimes(2)
  })
})
