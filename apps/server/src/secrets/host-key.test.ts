import { randomBytes } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { inspect } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readLaunchToken } from '../launch-token.ts'
import { createLogger } from '../logger.ts'
import { __resetSecretValues, redactDeep } from '../redact.ts'
import { HostKeyError, readHostMasterKey } from './host-key.ts'
import { createSecretBox } from './secret-box.ts'

const TOKEN = 'HostKey-launch_token-0123456789abcdefXYZ'
/** The host's format: 32 random bytes, base64url without padding (43 characters). */
const hostLine = (bytes: Buffer) => bytes.toString('base64url')

afterEach(() => {
  __resetSecretValues()
  vi.useRealTimers()
})

async function launchWith(...writes: (string | Buffer)[]) {
  const input = new PassThrough()
  const reading = readLaunchToken(input)
  for (const w of writes) input.write(w)
  return { input, launch: await reading }
}

async function failure(promise: Promise<unknown>): Promise<HostKeyError> {
  try {
    await promise
  } catch (err) {
    expect(err).toBeInstanceOf(HostKeyError)
    return err as HostKeyError
  }
  throw new Error('expected a HostKeyError')
}

describe('readHostMasterKey', () => {
  it('reads the 32-byte key from the line after the token', async () => {
    const raw = randomBytes(32)
    const { launch } = await launchWith(`${TOKEN}\n${hostLine(raw)}\n`)
    const key = await readHostMasterKey(launch)
    expect(key.encoded()).toBe(hostLine(raw))
    expect(Buffer.from(key.take()).equals(raw)).toBe(true)
  })

  it('joins a key split across chunks and drops a trailing CR', async () => {
    const raw = randomBytes(32)
    const line = hostLine(raw)
    const { input, launch } = await launchWith(`${TOKEN}\n${line.slice(0, 7)}`)
    const reading = readHostMasterKey(launch)
    input.write(`${line.slice(7)}\r\n`)
    expect(Buffer.from((await reading).take()).equals(raw)).toBe(true)
  })

  it('take() is one-shot', async () => {
    const { launch } = await launchWith(`${TOKEN}\n${hostLine(randomBytes(32))}\n`)
    const key = await readHostMasterKey(launch)
    expect(key.take()).toHaveLength(32)
    expect(() => key.take()).toThrow(/already taken/)
  })

  it('round trips: a host-format key opens a secret box that decrypts what it encrypted', async () => {
    const raw = randomBytes(32)
    const { launch } = await launchWith(`${TOKEN}\n${hostLine(raw)}\n`)
    const box = await createSecretBox((await readHostMasterKey(launch)).take())
    const again = await createSecretBox(new Uint8Array(raw))
    const blob = box.encrypt('sk-live-value', 'provider_credentials:pcr_1')
    expect(again.decrypt(blob, 'provider_credentials:pcr_1')).toBe('sk-live-value')
  })

  it('fails as missing when stdin ends before the key line', async () => {
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}\n`)
    const err = await failure(readHostMasterKey(await reading))
    expect(err.code).toBe('missing')
  })

  it('fails as missing when stdin ends inside the key line, without echoing it', async () => {
    const line = hostLine(randomBytes(32))
    const input = new PassThrough()
    const reading = readLaunchToken(input)
    input.end(`${TOKEN}\n${line}`)
    const err = await failure(readHostMasterKey(await reading))
    expect(err.code).toBe('missing')
    expect(err.message).not.toContain(line)
  })

  it.each([
    ['short', () => hostLine(randomBytes(31))],
    ['long', () => hostLine(randomBytes(33))],
    ['padded standard base64', () => randomBytes(32).toString('base64')],
    ['outside the charset', () => `${hostLine(randomBytes(32)).slice(0, 42)}!`],
    ['non-canonical last character', () => `${hostLine(Buffer.alloc(32)).slice(0, 42)}B`],
    ['empty', () => ''],
    ['the token again', () => TOKEN],
  ])('rejects a %s key line without echoing it', async (_label, make) => {
    const bad = make()
    const { launch } = await launchWith(`${TOKEN}\n${bad}\n`)
    const err = await failure(readHostMasterKey(launch))
    expect(err.code).toBe('invalid')
    if (bad !== '') expect(err.message).not.toContain(bad)
    expect(String(err.stack)).not.toContain(bad || '\u0000')
  })

  it('rejects a key line longer than the cap without waiting for its end', async () => {
    const { launch } = await launchWith(`${TOKEN}\n${'a'.repeat(4096)}`)
    const err = await failure(readHostMasterKey(launch))
    expect(err.code).toBe('invalid')
    expect(err.message).not.toContain('aaaa')
  })

  it('times out when no key line arrives, and drops what it had', async () => {
    vi.useFakeTimers()
    const { launch } = await launchWith(`${TOKEN}\npartial-key`)
    const settled = failure(readHostMasterKey(launch, { timeoutMs: 5_000 }))
    await vi.advanceTimersByTimeAsync(5_001)
    const err = await settled
    expect(err.code).toBe('timeout')
    expect(err.message).not.toContain('partial-key')
    expect(launch.takeRemainder().length).toBe(0)
  })

  it('never shows its bytes when logged, inspected or serialized', async () => {
    const line = hostLine(randomBytes(32))
    const { launch } = await launchWith(`${TOKEN}\n${line}\n`)
    const key = await readHostMasterKey(launch)
    const lines: string[] = []
    const logger = createLogger({
      level: 'info',
      stream: { write: (c: string) => void lines.push(c) },
    })
    logger.info({ key, nested: { key } }, 'with the key object')
    expect(lines.join('')).not.toContain(line)
    expect(JSON.stringify(key)).not.toContain(line)
    expect(inspect(key)).not.toContain(line)
    expect(String(key)).not.toContain(line)
    expect(JSON.stringify(redactDeep({ key }))).not.toContain(line)
  })
})
