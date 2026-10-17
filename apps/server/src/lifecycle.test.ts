import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installLifecycle } from './lifecycle.ts'
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
