import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'faire-main-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function runMain(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: join(import.meta.dirname, '..'),
      env: { PATH: process.env.PATH ?? '', FAIRE_SECRETS_DIR: join(dir, 'secrets'), ...env },
    })
    let output = ''
    child.stdout.on('data', (d) => void (output += d))
    child.stderr.on('data', (d) => void (output += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, output }))
  })
}

describe('main entrypoint', () => {
  it('exits 1 naming DATABASE_URL when it is missing', async () => {
    const { code, output } = await runMain({})
    expect(code).toBe(1)
    expect(output).toContain('DATABASE_URL')
  }, 30_000)

  it('exits 1 on an unreachable database without printing the password', async () => {
    const { code, output } = await runMain({
      DATABASE_URL: 'postgres://faire:hunter2-pw@127.0.0.1:1/faire',
    })
    expect(code).toBe(1)
    expect(output).not.toContain('hunter2-pw')
    expect(output).toMatch(/ECONNREFUSED|boot failed/)
  }, 30_000)
})
