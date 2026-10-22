import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { __resetSecretValues } from './redact.ts'
import { type MainDeps, runMain } from './run-main.ts'
import type { RunningServer } from './server.ts'

const TOKEN = 'RunMain-launch_token-0123456789abcdefXYZ'
const DESKTOP_ENV = {
  MAWL_MODE: 'desktop',
  MAWL_DATA_DIR: resolve('mawl-run-main-data'),
  DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl',
  LOG_LEVEL: 'info',
}

afterEach(() => {
  __resetSecretValues()
})

function setup(env: Record<string, string>, opts: { boot?: Promise<RunningServer> } = {}) {
  const out: string[] = []
  const stdin = new PassThrough()
  const stop = vi.fn(async () => {})
  const server = { url: 'http://127.0.0.1:1', stop } as unknown as RunningServer
  const started: Config[] = []
  const exit = vi.fn()
  const getStdin = vi.fn(() => stdin)
  const deps: MainDeps = {
    env,
    stdin: getStdin,
    proc: new EventEmitter(),
    exit,
    stderr: { write: (s: string) => void out.push(s) },
    logStream: { write: (s: string) => void out.push(s) },
    startServer: async (config, overrides) => {
      started.push(config)
      // The real server logs through this logger; prove the token is censored there too.
      overrides?.logger?.info({ token: config.launchToken, echo: `x${config.launchToken}` }, 'boot')
      return opts.boot ?? server
    },
  }
  runMain(deps)
  return { out, stdin, stop, exit, started, getStdin, text: () => out.join('') }
}

describe('runMain', () => {
  it('prints config errors to stderr and exits 1', () => {
    const s = setup({})
    expect(s.exit).toHaveBeenCalledWith(1)
    expect(s.text()).toContain('DATABASE_URL')
    expect(s.started).toHaveLength(0)
  })

  it('never touches stdin in headless mode', async () => {
    const s = setup({ DATABASE_URL: 'postgres://mawl:pw@db/mawl' })
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    expect(s.getStdin).not.toHaveBeenCalled()
    expect(s.started[0]?.launchToken).toBeUndefined()
  })

  it('in desktop mode boots only after the token line, with the token in the config only', async () => {
    const s = setup(DESKTOP_ENV)
    await new Promise((r) => setImmediate(r))
    expect(s.started).toHaveLength(0)
    s.stdin.write(`${TOKEN}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    expect(s.started[0]?.launchToken).toBe(TOKEN)
    expect(s.text()).toContain('boot')
    expect(s.text()).not.toContain(TOKEN)
  })

  it('stops gracefully and exits 0 when stdin ends after the token', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.write(`${TOKEN}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    s.stdin.end()
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0))
    expect(s.stop).toHaveBeenCalledTimes(1)
    expect(s.text()).toContain('stdin_eof')
  })

  it('waits for a pending boot when stdin ends mid-boot, then stops', async () => {
    let finish!: (server: RunningServer) => void
    const boot = new Promise<RunningServer>((r) => {
      finish = r
    })
    const s = setup(DESKTOP_ENV, { boot })
    s.stdin.end(`${TOKEN}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    await new Promise((r) => setImmediate(r))
    expect(s.exit).not.toHaveBeenCalled()
    const stop = vi.fn(async () => {})
    finish({ url: 'http://127.0.0.1:1', stop } as unknown as RunningServer)
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(0))
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('exits 1 without booting when the token is invalid, never printing it', async () => {
    const s = setup(DESKTOP_ENV)
    const bad = 'Bad!Token-0123456789abcdefghijklmnopq'
    s.stdin.write(`${bad}\n`)
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
    expect(s.started).toHaveLength(0)
    expect(s.text()).toContain('launch token invalid')
    expect(s.text()).not.toContain(bad)
  })

  it('exits 1 without booting when stdin closes before the token', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.end()
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
    expect(s.started).toHaveLength(0)
    expect(s.text()).toContain('launch token missing')
  })
})
