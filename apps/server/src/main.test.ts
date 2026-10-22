import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runNode, spawnNode } from './run-node.test-util.ts'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-main-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const SERVER_DIR = join(import.meta.dirname, '..')
/** Distinctive, so any echo in the output is caught. */
const TOKEN = 'Wd0g-DISTINCT_launch-token-9f3k2m7q1x8z4c6v'
/** A master key line in the host's format (43 base64url characters), distinctive as well. */
const KEY = 'Mk7q-DISTINCT_master-key-0a1b2c3d4e5f6g7h8g'

const runMain = (env: Record<string, string>, stdin?: string) =>
  runNode(['--import', 'tsx', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { MAWL_SECRETS_DIR: join(dir, 'secrets'), ...env },
    ...(stdin === undefined ? {} : { stdin }),
  })

const desktopEnv = (): Record<string, string> => ({
  MAWL_MODE: 'desktop',
  MAWL_DATA_DIR: join(dir, 'data'),
})

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => resolve(port))
    })
  })
}

describe('main entrypoint', () => {
  it('exits 1 naming DATABASE_URL when it is missing', async () => {
    const { code, output } = await runMain({})
    expect(code).toBe(1)
    expect(output).toContain('DATABASE_URL')
  }, 60_000)

  it('exits 1 on an unreachable database without printing the password', async () => {
    const { code, output } = await runMain({
      DATABASE_URL: 'postgres://mawl:hunter2-pw@127.0.0.1:1/mawl',
    })
    expect(code).toBe(1)
    expect(output).not.toContain('hunter2-pw')
    expect(output).toMatch(/ECONNREFUSED|boot failed/)
  }, 60_000)
})

describe('main entrypoint in headless mode', () => {
  it('never reads stdin: a token-like line and stdin closing change nothing', async () => {
    const port = await freePort()
    const proc = spawnNode(['--import', 'tsx', 'src/desktop-main.fixture.ts'], {
      cwd: SERVER_DIR,
      env: {
        MAWL_SECRETS_DIR: join(dir, 'secrets'),
        DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl',
        MAWL_PORT: String(port),
      },
    })
    try {
      await proc.waitForOutput(/"msg":"listening"/)
      proc.child.stdin.on('error', () => {})
      proc.child.stdin.end(`${TOKEN}\n`)
      // Give a watchdog, had there been one, time to react to the EOF.
      await new Promise((resolve) => setTimeout(resolve, 500))
      expect(proc.child.exitCode).toBeNull()
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
      expect(proc.output()).not.toContain('stdin_eof')
      expect(proc.output()).not.toContain('shutting down')
    } finally {
      proc.child.kill()
      await proc.exited
    }
  }, 60_000)
})

describe('main entrypoint in desktop mode', () => {
  it('exits 1 with a clear error when stdin closes before the launch token', async () => {
    const { code, output } = await runMain({
      ...desktopEnv(),
      DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl',
    })
    expect(code).toBe(1)
    expect(output).toContain('launch token missing')
    expect(output).toContain('LaunchTokenError')
  }, 60_000)

  it('exits 1 on an invalid launch token without printing it', async () => {
    const bad = 'Wd0g-DISTINCT_bad!token-9f3k2m7q1x8z4c6v'
    const { code, output } = await runMain(
      { ...desktopEnv(), DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl' },
      `${bad}\n`,
    )
    expect(code).toBe(1)
    expect(output).toContain('launch token invalid')
    expect(output).not.toContain('DISTINCT_bad')
  }, 60_000)

  it('exits 1 with a clear error when stdin closes after the token but before the master key', async () => {
    const { code, output } = await runMain(
      { ...desktopEnv(), DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl' },
      `${TOKEN}\n`,
    )
    expect(code).toBe(1)
    expect(output).toContain('master key missing')
    expect(output).toContain('HostKeyError')
  }, 60_000)

  // Nothing on this path logs the token, so this checks boot-failure output only. The redaction
  // itself is proven below (the fixture logs the token on purpose) and in run-main/logger tests.
  it('boot-failure output after a valid token contains neither the token nor the db password', async () => {
    const { code, output } = await runMain(
      { ...desktopEnv(), DATABASE_URL: 'postgres://mawl:hunter2-pw@127.0.0.1:1/mawl' },
      `${TOKEN}\n${KEY}\n`,
    )
    expect(code).toBe(1)
    expect(output).toContain('boot failed')
    expect(output).not.toContain(KEY)
    expect(output).not.toContain('DISTINCT_master')
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain('DISTINCT_launch')
    expect(output).not.toContain('hunter2-pw')
  }, 60_000)

  it('serves after the token line and stops gracefully with exit 0 when stdin closes', async () => {
    const port = await freePort()
    const proc = spawnNode(['--import', 'tsx', 'src/desktop-main.fixture.ts'], {
      cwd: SERVER_DIR,
      env: {
        ...desktopEnv(),
        DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl',
        MAWL_PORT: String(port),
        LOG_LEVEL: 'debug',
      },
    })
    try {
      proc.child.stdin.write(`${TOKEN}\n${KEY}\n`)
      await proc.waitForOutput(/"msg":"listening"/)
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200)
      proc.child.stdin.end()
      expect(await proc.exited).toBe(0)
      const output = proc.output()
      expect(output).toContain('fixture saw [Redacted]')
      expect(output).toContain('fixture saw key [Redacted]')
      expect(output).not.toContain(KEY)
      expect(output).not.toContain('DISTINCT_master')
      expect(output).toContain('stdin_eof')
      expect(output).toContain('"msg":"stopped"')
      expect(output).not.toContain(TOKEN)
      expect(output).not.toContain('DISTINCT_launch')
    } finally {
      proc.child.kill()
    }
  }, 60_000)
})
