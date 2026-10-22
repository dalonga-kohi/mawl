import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLifecycle, stopAfterBoot } from './lifecycle.ts'
import { createLogger } from './logger.ts'

function setup(stop: () => Promise<void>) {
  const lines: string[] = []
  const logger = createLogger({
    level: 'info',
    stream: { write: (c: string) => void lines.push(c) },
  })
  const proc = new EventEmitter()
  const exit = vi.fn()
  installLifecycle({ logger, stop, exit, proc, deadlineMs: 10_000 })
  return { proc, exit, lines }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('installLifecycle', () => {
  it('stops cleanly and exits 0 on SIGTERM', async () => {
    const stop = vi.fn(async () => {})
    const { proc, exit } = setup(stop)
    proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when stop fails, without logging the message', async () => {
    const { proc, exit, lines } = setup(async () => {
      throw Object.assign(new Error('postgres://u:LEAK-ME@h/d'), { code: 'EPIPE' })
    })
    proc.emit('SIGINT')
    await vi.advanceTimersByTimeAsync(0)
    expect(exit).toHaveBeenCalledWith(1)
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('forces exit 1 when shutdown exceeds the deadline', async () => {
    const { proc, exit } = setup(() => new Promise(() => {}))
    proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(9_999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('does not start a second shutdown, and a second signal exits immediately', async () => {
    const stop = vi.fn(() => new Promise<void>(() => {}))
    const { proc, exit } = setup(stop)
    proc.emit('SIGTERM')
    expect(exit).not.toHaveBeenCalled()
    proc.emit('SIGINT')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('handles a second fatal event while the first is being processed only once', () => {
    const { proc, exit, lines } = setup(async () => {})
    proc.emit('uncaughtException', new Error('a'))
    proc.emit('unhandledRejection', new Error('b'))
    expect(exit).toHaveBeenCalledTimes(1)
    expect(lines.filter((l) => l.includes('fatal error'))).toHaveLength(1)
  })

  it.each(['unhandledRejection', 'uncaughtException'])(
    'logs %s by name and code and exits 1',
    async (event) => {
      const { proc, exit, lines } = setup(async () => {})
      proc.emit(event, Object.assign(new Error('apiKey=LEAK-ME'), { code: 'ERR_X' }))
      expect(exit).toHaveBeenCalledWith(1)
      const out = lines.join('')
      expect(out).toContain('ERR_X')
      expect(out).not.toContain('LEAK-ME')
    },
  )
})

describe('installLifecycle shutdown()', () => {
  it('runs the same graceful stop as a signal and exits 0', async () => {
    const stop = vi.fn(async () => {})
    const proc = new EventEmitter()
    const exit = vi.fn()
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      stream: { write: (c: string) => void lines.push(c) },
    })
    const { shutdown } = installLifecycle({ logger, stop, exit, proc })
    shutdown('stdin_eof')
    await vi.advanceTimersByTimeAsync(0)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
    expect(lines.join('')).toContain('stdin_eof')
  })

  it('counts as the first signal: a later SIGTERM exits 1 at once', () => {
    const stop = vi.fn(() => new Promise<void>(() => {}))
    const proc = new EventEmitter()
    const exit = vi.fn()
    const { shutdown } = installLifecycle({
      logger: createLogger({ level: 'silent' }),
      stop,
      exit,
      proc,
    })
    shutdown('stdin_eof')
    proc.emit('SIGTERM')
    expect(stop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(1)
  })
})

describe('installLifecycle emergency stop', () => {
  function withEmergency(emergencyStop: () => Promise<unknown>, stop = async () => {}) {
    const proc = new EventEmitter()
    const exit = vi.fn()
    const spy = vi.fn(emergencyStop)
    installLifecycle({
      logger: createLogger({ level: 'silent' }),
      stop,
      exit,
      proc,
      emergencyStop: spy,
      deadlineMs: 10_000,
    })
    return { proc, exit, emergencyStop: spy }
  }

  it.each(['uncaughtException', 'unhandledRejection'])(
    'runs it before exiting 1 on %s',
    async (event) => {
      let release!: () => void
      const s = withEmergency(() => new Promise<void>((r) => (release = r)))
      s.proc.emit(event, new Error('x'))
      expect(s.emergencyStop).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(s.exit).not.toHaveBeenCalled()
      release()
      await vi.advanceTimersByTimeAsync(0)
      expect(s.exit).toHaveBeenCalledWith(1)
    },
  )

  it('runs it before exiting 1 on a second signal', async () => {
    const s = withEmergency(
      async () => {},
      () => new Promise(() => {}),
    )
    s.proc.emit('SIGTERM')
    s.proc.emit('SIGTERM')
    expect(s.emergencyStop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(s.exit).toHaveBeenCalledTimes(1)
    expect(s.exit).toHaveBeenCalledWith(1)
  })

  it('runs it before exiting 1 when the shutdown deadline passes', async () => {
    const s = withEmergency(
      async () => {},
      () => new Promise(() => {}),
    )
    s.proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(10_001)
    expect(s.emergencyStop).toHaveBeenCalledTimes(1)
    expect(s.exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 after 3 s when it hangs', async () => {
    const s = withEmergency(() => new Promise(() => {}))
    s.proc.emit('uncaughtException', new Error('x'))
    await vi.advanceTimersByTimeAsync(2_999)
    expect(s.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(s.exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 when it throws or rejects', async () => {
    const sync = withEmergency(() => {
      throw new Error('sync')
    })
    sync.proc.emit('uncaughtException', new Error('x'))
    await vi.advanceTimersByTimeAsync(0)
    expect(sync.exit).toHaveBeenCalledWith(1)
    const rejected = withEmergency(async () => {
      throw new Error('async')
    })
    rejected.proc.emit('unhandledRejection', new Error('x'))
    await vi.advanceTimersByTimeAsync(0)
    expect(rejected.exit).toHaveBeenCalledWith(1)
  })

  it('is not run on a clean shutdown, and exits only once', async () => {
    const s = withEmergency(async () => {})
    s.proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(0)
    expect(s.emergencyStop).not.toHaveBeenCalled()
    expect(s.exit).toHaveBeenCalledTimes(1)
    expect(s.exit).toHaveBeenCalledWith(0)
  })
})

describe('stopAfterBoot', () => {
  function pending() {
    let resolve!: (s: { stop: () => Promise<void> }) => void
    let reject!: (e: unknown) => void
    const booting = new Promise<{ stop: () => Promise<void> }>((res, rej) => {
      resolve = res
      reject = rej
    })
    booting.catch(() => {})
    return { booting, resolve, reject }
  }

  it('does not stop or exit on SIGTERM until boot settles, then stops and exits 0', async () => {
    const { booting, resolve } = pending()
    const serverStop = vi.fn(async () => {})
    const { proc, exit } = setup(stopAfterBoot(booting))
    proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(serverStop).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()
    resolve({ stop: serverStop })
    await vi.advanceTimersByTimeAsync(0)
    expect(serverStop).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits 1 when boot fails, without stopping a server that never started', async () => {
    const { booting, reject } = pending()
    const { proc, exit } = setup(stopAfterBoot(booting))
    proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(0)
    expect(exit).not.toHaveBeenCalled()
    reject(new Error('boot failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(exit).toHaveBeenCalledWith(1)
    expect(exit).not.toHaveBeenCalledWith(0)
  })
})

describe('shutdown deadline vs boot', () => {
  it('does not start the 10 s deadline until boot has settled', async () => {
    let boot!: () => void
    const booted = new Promise<void>((resolve) => {
      boot = resolve
    })
    const logger = createLogger({ level: 'silent' })
    const proc = new EventEmitter()
    const exit = vi.fn()
    installLifecycle({
      logger,
      stop: () => new Promise(() => {}),
      exit,
      proc,
      booted,
      deadlineMs: 10_000,
    })
    proc.emit('SIGTERM')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(exit).not.toHaveBeenCalled()
    boot()
    await vi.advanceTimersByTimeAsync(9_999)
    expect(exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('still exits immediately on a second signal while boot is pending', async () => {
    const logger = createLogger({ level: 'silent' })
    const proc = new EventEmitter()
    const exit = vi.fn()
    installLifecycle({
      logger,
      stop: () => new Promise(() => {}),
      exit,
      proc,
      booted: new Promise(() => {}),
    })
    proc.emit('SIGTERM')
    proc.emit('SIGTERM')
    expect(exit).toHaveBeenCalledWith(1)
  })
})
