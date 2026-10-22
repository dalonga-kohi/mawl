import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LaunchTokenError, readLaunchToken } from './launch-token.ts'

const TOKEN = 'Zx9-launch_Token-0123456789abcdefghijKLMN'

const tick = () => new Promise((resolve) => setImmediate(resolve))

async function failure(promise: Promise<unknown>): Promise<LaunchTokenError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(LaunchTokenError)
    return err as LaunchTokenError
  }
  throw new Error('expected a LaunchTokenError')
}

afterEach(() => {
  vi.useRealTimers()
})

describe('readLaunchToken', () => {
  it('reads the first line', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n`)
    await expect(reading).resolves.toBe(TOKEN)
  })

  it('joins a token split across chunks and drops a trailing CR', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(TOKEN.slice(0, 10))
    await tick()
    input.write(`${TOKEN.slice(10)}\r\nlater lines are ignored\n`)
    await expect(reading).resolves.toBe(TOKEN)
  })

  it.each([
    ['too short', 'short-token'],
    ['outside the charset', `${TOKEN.slice(0, 32)}!$`],
    ['containing a space', `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}`],
    ['empty', ''],
  ])('rejects a token %s without echoing it', async (_label, bad) => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${bad}\n`)
    const err = await failure(reading)
    expect(err.code).toBe('invalid')
    if (bad !== '') expect(err.message).not.toContain(bad)
  })

  it('rejects a first line longer than the cap without waiting for its end', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write('a'.repeat(4096))
    const err = await failure(reading)
    expect(err.code).toBe('invalid')
    expect(err.message).not.toContain('aaaa')
  })

  it('fails as missing when stdin ends before a full line', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(TOKEN)
    const err = await failure(reading)
    expect(err.code).toBe('missing')
    expect(err.message).not.toContain(TOKEN)
  })

  it('fails as missing when stdin errors first', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.destroy(new Error('EPIPE'))
    expect((await failure(reading)).code).toBe('missing')
  })

  it('times out when no line arrives', async () => {
    vi.useFakeTimers()
    const input = new PassThrough()
    const reading = readLaunchToken(input, { timeoutMs: 5_000 })
    const settled = failure(reading)
    await vi.advanceTimersByTimeAsync(5_001)
    expect((await settled).code).toBe('timeout')
  })
})

describe('readLaunchToken parent watchdog', () => {
  it('reports the parent gone when stdin ends after the token', async () => {
    const input = new PassThrough()
    const onParentGone = vi.fn()
    const reading = readLaunchToken(input, { onParentGone })
    input.write(`${TOKEN}\nextra`)
    await reading
    expect(onParentGone).not.toHaveBeenCalled()
    input.end()
    await vi.waitFor(() => expect(onParentGone).toHaveBeenCalledTimes(1))
  })

  it('reports the parent gone once even when stdin ends in the same chunk as the token', async () => {
    const input = new PassThrough()
    const onParentGone = vi.fn()
    const reading = readLaunchToken(input, { onParentGone })
    input.end(`${TOKEN}\n`)
    await expect(reading).resolves.toBe(TOKEN)
    await vi.waitFor(() => expect(onParentGone).toHaveBeenCalledTimes(1))
    await tick()
    expect(onParentGone).toHaveBeenCalledTimes(1)
  })

  it('reports the parent gone when stdin errors after the token', async () => {
    const input = new PassThrough()
    const onParentGone = vi.fn()
    await Promise.all([readLaunchToken(input, { onParentGone }), input.write(`${TOKEN}\n`)])
    input.destroy(new Error('EPIPE'))
    await vi.waitFor(() => expect(onParentGone).toHaveBeenCalledTimes(1))
  })

  it('does not report the parent gone when the token was rejected', async () => {
    const input = new PassThrough()
    const onParentGone = vi.fn()
    const reading = readLaunchToken(input, { onParentGone })
    input.end('bad\n')
    await failure(reading)
    await tick()
    expect(onParentGone).not.toHaveBeenCalled()
  })
})
