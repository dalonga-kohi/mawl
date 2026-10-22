import { randomBytes } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from './config.ts'
import { __resetSecretValues } from './redact.ts'
import { type MainDeps, runMain } from './run-main.ts'
import type { BootOverrides, RunningServer } from './server.ts'

const TOKEN = 'RunMain-launch_token-0123456789abcdefXYZ'
const KEY_BYTES = randomBytes(32)
/** The host's format: base64url, 43 characters. */
const KEY = KEY_BYTES.toString('base64url')
const DESKTOP_ENV = {
  MAWL_MODE: 'desktop',
  MAWL_DATA_DIR: resolve('mawl-run-main-data'),
  DATABASE_URL: 'postgres://mawl:pw@127.0.0.1:1/mawl',
  LOG_LEVEL: 'info',
}

afterEach(() => {
  __resetSecretValues()
})

function setup(
  env: Record<string, string>,
  opts: { boot?: Promise<RunningServer>; tokenTimeoutMs?: number; keyTimeoutMs?: number } = {},
) {
  const out: string[] = []
  const stdin = new PassThrough()
  const stop = vi.fn(async () => {})
  const server = { url: 'http://127.0.0.1:1', stop } as unknown as RunningServer
  const started: Config[] = []
  const overrides: (BootOverrides | undefined)[] = []
  const proc = new EventEmitter()
  const exit = vi.fn()
  const getStdin = vi.fn(() => stdin)
  const deps: MainDeps = {
    env,
    stdin: getStdin,
    proc,
    exit,
    stderr: { write: (s: string) => void out.push(s) },
    logStream: { write: (s: string) => void out.push(s) },
    startServer: async (config, o) => {
      started.push(config)
      overrides.push(o)
      // The real server logs through this logger; prove the token is censored there too.
      o?.logger?.info({ token: config.launchToken, echo: `x${config.launchToken}` }, 'boot')
      // And the master key's text form, unkeyed and in a message.
      const key = o?.hostMasterKey?.encoded()
      o?.logger?.info({ note: `k${key}k`, key: o?.hostMasterKey }, `saw key ${key}`)
      return opts.boot ?? server
    },
  }
  if (opts.tokenTimeoutMs !== undefined) deps.tokenTimeoutMs = opts.tokenTimeoutMs
  if (opts.keyTimeoutMs !== undefined) deps.keyTimeoutMs = opts.keyTimeoutMs
  runMain(deps)
  return { out, stdin, stop, exit, started, overrides, proc, getStdin, text: () => out.join('') }
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

  it('in headless mode shows a generated owner token on stderr, around the log redactor', async () => {
    const s = setup({ DATABASE_URL: 'postgres://mawl:pw@db/mawl' })
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    const announce = s.overrides[0]?.announceOwnerToken
    expect(announce).toBeTypeOf('function')
    announce?.('notice with the token\n')
    expect(s.text()).toContain('notice with the token')
  })

  it('in desktop mode never offers a way to print a token', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.write(`${TOKEN}\n${KEY}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    expect(s.overrides[0]?.announceOwnerToken).toBeUndefined()
  })

  it('in desktop mode boots only after the token line, with the token in the config only', async () => {
    const s = setup(DESKTOP_ENV)
    await new Promise((r) => setImmediate(r))
    expect(s.started).toHaveLength(0)
    s.stdin.write(`${TOKEN}\n${KEY}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    expect(s.started[0]?.launchToken).toBe(TOKEN)
    expect(s.text()).toContain('boot')
    expect(s.text()).not.toContain(TOKEN)
  })

  it('stops gracefully and exits 0 when stdin ends after the token', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.write(`${TOKEN}\n${KEY}\n`)
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
    s.stdin.end(`${TOKEN}\n${KEY}\n`)
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

  it('runs the emergency stops the server registered before a fatal exit', async () => {
    const s = setup({ DATABASE_URL: 'postgres://mawl:pw@db/mawl' })
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    const registered = s.overrides[0]?.registerEmergencyStop
    expect(registered).toBeTypeOf('function')
    const pgStop = vi.fn(async () => {})
    registered?.(pgStop)
    s.proc.emit('uncaughtException', new Error('boom'))
    expect(pgStop).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
  })

  it('applies tokenTimeoutMs: no token line in time exits 1 without booting', async () => {
    vi.useFakeTimers()
    try {
      const s = setup(DESKTOP_ENV, { tokenTimeoutMs: 200 })
      await vi.advanceTimersByTimeAsync(199)
      expect(s.exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2)
      expect(s.exit).toHaveBeenCalledWith(1)
      expect(s.started).toHaveLength(0)
      expect(s.text()).toContain('no first line on stdin in time')
    } finally {
      vi.useRealTimers()
    }
  })

  it('in desktop mode passes the master key line to the server, and no log line carries it', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.write(`${TOKEN}\n`)
    await new Promise((r) => setImmediate(r))
    expect(s.started).toHaveLength(0)
    s.stdin.write(`${KEY}\n`)
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    const key = s.overrides[0]?.hostMasterKey
    expect(Buffer.from(key?.take() ?? []).equals(KEY_BYTES)).toBe(true)
    expect(s.text()).toContain('saw key [Redacted]')
    expect(s.text()).not.toContain(KEY)
    expect(JSON.stringify(s.started[0])).not.toContain(KEY)
  })

  it('never reads a master key in headless mode', async () => {
    const s = setup({ DATABASE_URL: 'postgres://mawl:pw@db/mawl' })
    await vi.waitFor(() => expect(s.started).toHaveLength(1))
    expect(s.overrides[0]?.hostMasterKey).toBeUndefined()
  })

  it('exits 1 without booting when stdin closes after the token but before the key', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.end(`${TOKEN}\n`)
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
    expect(s.started).toHaveLength(0)
    expect(s.text()).toContain('master key missing')
    expect(s.text()).toContain('HostKeyError')
  })

  it('exits 1 without booting on an invalid key line, never printing it', async () => {
    const s = setup(DESKTOP_ENV)
    const bad = `${KEY.slice(0, 40)}!!!`
    s.stdin.write(`${TOKEN}\n${bad}\n`)
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
    expect(s.started).toHaveLength(0)
    expect(s.text()).toContain('master key invalid')
    expect(s.text()).not.toContain(bad)
    expect(s.text()).not.toContain(KEY.slice(0, 40))
  })

  it('applies keyTimeoutMs: no key line in time exits 1 without booting', async () => {
    vi.useFakeTimers()
    try {
      const s = setup(DESKTOP_ENV, { keyTimeoutMs: 300 })
      s.stdin.write(`${TOKEN}\n`)
      await vi.advanceTimersByTimeAsync(299)
      expect(s.exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(2)
      expect(s.exit).toHaveBeenCalledWith(1)
      expect(s.started).toHaveLength(0)
      expect(s.text()).toContain('no second line on stdin in time')
    } finally {
      vi.useRealTimers()
    }
  })

  it('exits 1 without booting when stdin closes before the token', async () => {
    const s = setup(DESKTOP_ENV)
    s.stdin.end()
    await vi.waitFor(() => expect(s.exit).toHaveBeenCalledWith(1))
    expect(s.started).toHaveLength(0)
    expect(s.text()).toContain('launch token missing')
  })
})
