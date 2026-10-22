import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __internalRemainderOf,
  LaunchTokenError,
  MAX_REMAINDER_BYTES,
  readLaunchToken,
} from './launch-token.ts'

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
    await expect(reading).resolves.toMatchObject({ token: TOKEN })
  })

  it('joins a token split across chunks and drops a trailing CR', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(TOKEN.slice(0, 10))
    await tick()
    input.write(`${TOKEN.slice(10)}\r\nlater lines are ignored\n`)
    await expect(reading).resolves.toMatchObject({ token: TOKEN })
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

describe('readLaunchToken takeRemainder', () => {
  it('keeps the line after the token from the same chunk, and nothing after it', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\nkey-line-1\nlater`)
    const launch = await reading
    await launch.remainderReady
    expect(launch.takeRemainder().toString()).toBe('key-line-1\n')
  })

  it('joins a second line split across chunks and settles only once it is complete', async () => {
    const input = new PassThrough()
    const launch = await Promise.all([readLaunchToken(input), input.write(`${TOKEN}\nkey-`)]).then(
      ([l]) => l,
    )
    let ready = false
    void launch.remainderReady.then(() => {
      ready = true
    })
    await tick()
    expect(ready).toBe(false)
    input.write('line\r\n')
    await launch.remainderReady
    expect(launch.takeRemainder().toString()).toBe('key-line\r\n')
  })

  it('is one-shot: hands the bytes over, zero-fills its own copy, and the second call is empty', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\nsecret-key-line\n`)
    const launch = await reading
    await launch.remainderReady
    const first = launch.takeRemainder()
    expect(first.toString()).toBe('secret-key-line\n')
    expect(launch.takeRemainder().length).toBe(0)
    // What it handed over is the caller's own: zeroing it changes nothing inside.
    first.fill(0)
    expect(launch.takeRemainder().length).toBe(0)
  })

  it('zero-fills the internal buffer and the stdin chunks the key passed through', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    const first = Buffer.from(`${TOKEN}\nsecret-`)
    const second = Buffer.from('key-line\ntrailing')
    input.write(first)
    const launch = await reading
    input.write(second)
    await launch.remainderReady
    const internal = __internalRemainderOf(launch)
    expect(internal?.subarray(0, 16).toString()).toBe('secret-key-line\n')
    expect(launch.takeRemainder().toString()).toBe('secret-key-line\n')
    expect(internal?.every((b) => b === 0)).toBe(true)
    expect(first.every((b) => b === 0)).toBe(true)
    expect(second.every((b) => b === 0)).toBe(true)
  })

  it('stops buffering after the key line: later data is not kept', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\nkey\n`)
    const launch = await reading
    input.write(Buffer.alloc(MAX_REMAINDER_BYTES * 4, 0x61))
    await tick()
    expect(launch.takeRemainder().toString()).toBe('key\n')
  })

  it('stops buffering after a take, even before the key line arrived', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\npartial`)
    const launch = await reading
    expect(launch.takeRemainder().toString()).toBe('partial')
    input.write('-more\n')
    await tick()
    expect(launch.takeRemainder().length).toBe(0)
    await launch.remainderReady
  })

  it('caps a second line without a newline and settles, so a runaway parent cannot grow memory', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n`)
    const launch = await reading
    input.write(Buffer.alloc(MAX_REMAINDER_BYTES + 10, 0x61))
    await launch.remainderReady
    expect(launch.takeRemainder().length).toBe(MAX_REMAINDER_BYTES)
  })

  it('settles with what it has when stdin ends before the key line ends', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}\nkey-without-newline`)
    const launch = await reading
    await launch.remainderReady
    expect(launch.takeRemainder().toString()).toBe('key-without-newline')
  })

  it('is empty when nothing follows the token line and stdin ends', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}\n`)
    const launch = await reading
    await launch.remainderReady
    expect(launch.takeRemainder().length).toBe(0)
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
    await expect(reading).resolves.toMatchObject({ token: TOKEN })
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
