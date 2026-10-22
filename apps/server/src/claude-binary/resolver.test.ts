import { describe, expect, it, vi } from 'vitest'
import { ClaudeBinaryError } from './ensure.ts'
import type { ClaudeBinaryManifest } from './manifest.ts'
import { createClaudeExecutableResolver } from './resolver.ts'

const manifest: ClaudeBinaryManifest = {
  version: '1.0.0',
  packages: { 'win32-x64': { url: 'https://registry.example/x.tgz', integrity: 'sha512-AAAA' } },
}
const logger = { info: vi.fn(), warn: vi.fn() }

describe('createClaudeExecutableResolver', () => {
  it('uses the owner-configured path and never installs', async () => {
    const ensure = vi.fn()
    const resolve = createClaudeExecutableResolver({
      explicitPath: '/opt/claude',
      dataDir: '/data',
      manifest,
      logger,
      ensure,
    })
    expect(await resolve()).toBe('/opt/claude')
    expect(ensure).not.toHaveBeenCalled()
  })

  it('installs (or finds) the pinned binary in the data dir in desktop mode, only when called', async () => {
    const ensure = vi.fn(async () => '/data/claude/1.0.0/claude.exe')
    const resolve = createClaudeExecutableResolver({ dataDir: '/data', manifest, logger, ensure })
    expect(ensure).not.toHaveBeenCalled()
    const signal = new AbortController().signal
    expect(await resolve(signal)).toBe('/data/claude/1.0.0/claude.exe')
    expect(ensure).toHaveBeenCalledWith(
      expect.objectContaining({ dataDir: '/data', manifest, logger, signal }),
    )
  })

  it('headless: uses the binary of the SDK platform package installed beside the bundle', async () => {
    const ensure = vi.fn()
    const resolve = createClaudeExecutableResolver({
      manifest,
      logger,
      ensure,
      resolveBundled: () => '/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    })
    expect(await resolve()).toBe(
      '/app/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    )
    expect(ensure).not.toHaveBeenCalled()
  })

  it('dev run without an embedded manifest: same package lookup, nothing downloaded', async () => {
    const ensure = vi.fn()
    const resolve = createClaudeExecutableResolver({
      dataDir: '/data',
      logger,
      ensure,
      resolveBundled: () => null,
    })
    expect(await resolve()).toBeUndefined()
    expect(ensure).not.toHaveBeenCalled()
  })

  it('passes an install failure on, typed', async () => {
    const ensure = vi.fn(async () => {
      throw new ClaudeBinaryError('integrity_mismatch', 'bad')
    })
    const resolve = createClaudeExecutableResolver({ dataDir: '/data', manifest, logger, ensure })
    await expect(resolve()).rejects.toMatchObject({ code: 'integrity_mismatch' })
  })
})
