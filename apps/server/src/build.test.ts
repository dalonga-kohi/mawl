import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from './build.ts'
import { E2E_CREDENTIAL_LABEL, ECHO_MODEL_ID } from './e2e/echo.ts'
import { runNode } from './run-node.test-util.ts'

describe('production bundle', () => {
  let out: string
  let bundle: string

  beforeAll(async () => {
    out = await mkdtemp(join(tmpdir(), 'faire-build-'))
    await buildServer({ outdir: out })
    bundle = join(out, 'server.mjs')
  }, 60_000)

  afterAll(async () => {
    await rm(out, { recursive: true, force: true })
  })

  it('writes a single server.mjs with workspace packages inlined', () => {
    expect(existsSync(bundle)).toBe(true)
    const source = readFileSync(bundle, 'utf8')
    expect(source).not.toMatch(/from\s*["']@faire\//)
    expect(source).not.toMatch(/import\(["']@faire\//)
  })

  it('keeps the Claude Agent SDK external: it finds its native binary from its own install path', () => {
    const source = readFileSync(bundle, 'utf8')
    expect(source).toMatch(/import\(["']@anthropic-ai\/claude-agent-sdk["']\)/)
    // Bundled, the SDK would add ~1 MB and resolve the binary relative to server.mjs.
    expect(source.length).toBeLessThan(5_000_000)
    expect(source).not.toContain('Native CLI binary for')
  })

  it('never ships the e2e echo model or its server entry', () => {
    const source = readFileSync(bundle, 'utf8')
    expect(source).not.toContain(ECHO_MODEL_ID)
    expect(source).not.toContain(E2E_CREDENTIAL_LABEL)
    expect(source).not.toContain('FAIRE_E2E')
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
        DATABASE_URL: 'postgres://faire:hunter2-pw@127.0.0.1:1/faire',
        FAIRE_SECRETS_DIR: join(out, 'secrets'),
      },
    })
    expect(code).toBe(1)
    expect(output).toContain('boot failed')
    expect(output).not.toContain('hunter2-pw')
  }, 30_000)
})
