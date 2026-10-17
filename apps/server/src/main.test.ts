import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runNode } from './run-node.test-util.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'faire-main-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const runMain = (env: Record<string, string>) =>
  runNode(['--import', 'tsx', 'src/main.ts'], {
    cwd: join(import.meta.dirname, '..'),
    env: { FAIRE_SECRETS_DIR: join(dir, 'secrets'), ...env },
  })

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
