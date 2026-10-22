import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from './build.ts'
import { parseLockfileManifest } from './claude-binary/manifest.ts'
import { E2E_CREDENTIAL_LABEL, ECHO_MODEL_ID } from './e2e/echo.ts'
import { runNode } from './run-node.test-util.ts'

describe('production bundle', () => {
  let out: string
  let bundle: string

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'mawl-build-'))
    await buildServer({ outdir: out })
    bundle = join(out, 'server.mjs')
  }, 60_000)

  afterAll(async () => {
    await rm(out, { recursive: true, force: true })
  })

  it('writes a single server.mjs with workspace packages inlined', () => {
    expect(existsSync(bundle)).toBe(true)
    const source = readFileSync(bundle, 'utf8')
    expect(source).not.toMatch(/from\s*["']@mawl\//)
    expect(source).not.toMatch(/import\(["']@mawl\//)
  })

  it('inlines the Claude Agent SDK JS; the native binary is never part of the bundle', () => {
    const source = readFileSync(bundle, 'utf8')
    expect(source).not.toMatch(/import\(["']@anthropic-ai\/claude-agent-sdk["']\)/)
    expect(source).not.toMatch(/from\s*["']@anthropic-ai\/claude-agent-sdk["']/)
    // The SDK's own source is in there (its error text for a missing platform package) ...
    expect(source).toContain('Native CLI binary for')
    // ... but it is JS only (~1.3 MB): the 277 MB binary comes from the first-use download.
    expect(source.length).toBeLessThan(10_000_000)
  })

  it('embeds the lockfile pin of the Claude binary: https tarball urls with sha512 integrity', () => {
    const source = readFileSync(bundle, 'utf8')
    const lock = readFileSync(new URL('../../../pnpm-lock.yaml', import.meta.url), 'utf8')
    const manifest = parseLockfileManifest(lock)
    const win = manifest.packages['win32-x64']
    expect(win).toBeDefined()
    expect(source).toContain(
      `https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-${manifest.version}.tgz`,
    )
    expect(source).toContain(win?.integrity)
  })

  it('never ships the e2e echo model or its server entry', () => {
    const source = readFileSync(bundle, 'utf8')
    expect(source).not.toContain(ECHO_MODEL_ID)
    expect(source).not.toContain(E2E_CREDENTIAL_LABEL)
    expect(source).not.toContain('MAWL_E2E')
  })

  it('bakes in the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(readFileSync(bundle, 'utf8')).toContain(JSON.stringify(pkg.version))
  })

  it('ships the SQL migrations next to the bundle', () => {
    expect(existsSync(join(out, 'drizzle', 'meta', '_journal.json'))).toBe(true)
  })

  it('boots standalone and fails fast on an unreachable database without leaking the password', async () => {
    const { code, output } = await runNode([bundle], {
      cwd: out,
      env: {
        DATABASE_URL: 'postgres://mawl:hunter2-pw@127.0.0.1:1/mawl',
        MAWL_SECRETS_DIR: join(out, 'secrets'),
      },
    })
    expect(code).toBe(1)
    expect(output).toContain('boot failed')
    expect(output).not.toContain('hunter2-pw')
  }, 30_000)
})
