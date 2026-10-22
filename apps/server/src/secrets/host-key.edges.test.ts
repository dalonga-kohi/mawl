import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { __internalRemainderOf, readLaunchToken } from '../launch-token.ts'
import { __resetSecretValues } from '../redact.ts'
import { HostKeyError, readHostMasterKey } from './host-key.ts'

const TOKEN = 'HostKeyEdges-launch_token-0123456789abcdef'
const line = (bytes: Buffer) => bytes.toString('base64url')

afterEach(() => {
  __resetSecretValues()
  vi.useRealTimers()
})

async function failure(promise: Promise<unknown>): Promise<HostKeyError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(HostKeyError)
    return err as HostKeyError
  }
  throw new Error('expected a HostKeyError')
}

describe('the two-line stdin protocol, edge cases', () => {
  it('survives the whole stream arriving one byte at a time', async () => {
    const raw = randomBytes(32)
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    const all = Buffer.from(`${TOKEN}\r\n${line(raw)}\r\nignored\n`)
    for (const byte of all) input.write(Buffer.from([byte]))
    const launch = await reading
    const key = await readHostMasterKey(launch)
    expect(Buffer.from(key.take()).equals(raw)).toBe(true)
  })

  it('reads a CRLF token line and a CRLF key line in one chunk', async () => {
    const raw = randomBytes(32)
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\r\n${line(raw)}\r\n`)
    const key = await readHostMasterKey(await reading)
    expect(Buffer.from(key.take()).equals(raw)).toBe(true)
  })

  it('ignores extra lines after the key line and never keeps them', async () => {
    const raw = randomBytes(32)
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${line(raw)}\nthird-line-secret\nfourth\n`)
    const launch = await reading
    const key = await readHostMasterKey(launch)
    expect(Buffer.from(key.take()).equals(raw)).toBe(true)
    expect(launch.takeRemainder().length).toBe(0)
  })

  it('treats a key glued to the token line (no newline between) as one token and then misses the key', async () => {
    const raw = randomBytes(32)
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}${line(raw)}\n`)
    const launch = await reading
    expect(launch.token).toBe(`${TOKEN}${line(raw)}`)
    const err = await failure(readHostMasterKey(launch))
    expect(err.code).toBe('missing')
  })

  it('rejects a key line with trailing space, tab, NUL or a bare CR in the middle', async () => {
    for (const suffix of [' ', '\t', '\u0000', '\r\r']) {
      const input = new PassThrough()
      const reading = readLaunchToken(input)
      input.write(`${TOKEN}\n${line(randomBytes(32))}${suffix}\n`)
      const err = await failure(readHostMasterKey(await reading))
      expect(err.code).toBe('invalid')
    }
  })

  it('rejects a key line with leading whitespace or a BOM', async () => {
    for (const prefix of [' ', '﻿']) {
      const input = new PassThrough()
      const reading = readLaunchToken(input)
      input.write(`${TOKEN}\n${prefix}${line(randomBytes(32)).slice(1)}\n`)
      const err = await failure(readHostMasterKey(await reading))
      expect(err.code).toBe('invalid')
    }
  })

  it('rejects 43 bytes of multi-byte unicode without echoing it', async () => {
    // 21 two-byte characters plus one ASCII: 43 bytes, 22 characters.
    const bad = `${'é'.repeat(21)}a`
    expect(Buffer.byteLength(bad)).toBe(43)
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${bad}\n`)
    const err = await failure(readHostMasterKey(await reading))
    expect(err.code).toBe('invalid')
    expect(err.message).not.toContain('é')
  })

  it('rejects a lone CR as a line end (only LF ends the line)', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}\n${line(randomBytes(32))}\r`)
    const err = await failure(readHostMasterKey(await reading))
    expect(err.code).toBe('missing')
  })

  it('zero-fills the internal remainder after a successful read', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${line(randomBytes(32))}\n`)
    const launch = await reading
    const internal = __internalRemainderOf(launch)
    await readHostMasterKey(launch)
    expect(internal?.every((b) => b === 0)).toBe(true)
  })

  it('zero-fills the internal remainder after a rejected key line', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${'Q'.repeat(43).slice(0, 42)}!\n`)
    const launch = await reading
    const internal = __internalRemainderOf(launch)
    await failure(readHostMasterKey(launch))
    expect(internal?.every((b) => b === 0)).toBe(true)
  })

  it('zero-fills the internal remainder after a timeout', async () => {
    vi.useFakeTimers()
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${line(randomBytes(32)).slice(0, 30)}`)
    const launch = await reading
    const internal = __internalRemainderOf(launch)
    const settled = failure(readHostMasterKey(launch, { timeoutMs: 100 }))
    await vi.advanceTimersByTimeAsync(101)
    expect((await settled).code).toBe('timeout')
    expect(internal?.every((b) => b === 0)).toBe(true)
  })

  it('leaves no timer behind after a successful read', async () => {
    vi.useFakeTimers()
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${line(randomBytes(32))}\n`)
    const launch = await reading
    await readHostMasterKey(launch, { timeoutMs: 60_000 })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('a second read on the same launch gets nothing (the first took the line)', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${line(randomBytes(32))}\n`)
    const launch = await reading
    await readHostMasterKey(launch)
    const err = await failure(readHostMasterKey(launch, { timeoutMs: 50 }))
    expect(['missing', 'timeout']).toContain(err.code)
  })

  it('does not echo a rejected 44-character key line in the stack either', async () => {
    const bad = `${line(randomBytes(32))}A`
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.write(`${TOKEN}\n${bad}\n`)
    const err = await failure(readHostMasterKey(await reading))
    expect(err.code).toBe('invalid')
    expect(String(err.stack)).not.toContain(bad)
    expect(JSON.stringify(err)).not.toContain(bad)
  })
})
