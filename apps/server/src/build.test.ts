import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildServer } from './build.ts'

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

  it('bakes in the package version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    expect(readFileSync(bundle, 'utf8')).toContain(JSON.stringify(pkg.version))
  })

  it('ships the SQL migrations next to the bundle', () => {
    expect(existsSync(join(out, 'drizzle', 'meta', '_journal.json'))).toBe(true)
  })

  it('boots standalone and fails fast on an unreachable database without leaking the password', async () => {
    const { code, output } = await new Promise<{ code: number | null; output: string }>(
      (resolve, reject) => {
        const child = spawn(process.execPath, [bundle], {
          cwd: out,
          env: {
            PATH: process.env.PATH ?? '',
            DATABASE_URL: 'postgres://faire:hunter2-pw@127.0.0.1:1/faire',
            FAIRE_SECRETS_DIR: join(out, 'secrets'),
          },
        })
        let text = ''
        child.stdout.on('data', (d) => void (text += d))
        child.stderr.on('data', (d) => void (text += d))
        child.on('error', reject)
        child.on('close', (c) => resolve({ code: c, output: text }))
      },
    )
    expect(code).toBe(1)
    expect(output).toContain('boot failed')
    expect(output).not.toContain('hunter2-pw')
  }, 30_000)
})
