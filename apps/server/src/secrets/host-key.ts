import { inspect } from 'node:util'
import type { LaunchToken } from '../launch-token.ts'
import { MASTER_KEY_BYTES } from './master-key.ts'

/** The host's encoding of 32 bytes: base64url without padding. */
const KEY_LINE = /^[A-Za-z0-9_-]{43}$/
/** Longer than a key line can be (43 characters, CR, LF). */
const KEY_LINE_MAX = 45
export const HOST_KEY_TIMEOUT_MS = 15_000

export type HostKeyErrorCode = 'missing' | 'invalid' | 'timeout'

/** The desktop host's master key line is unusable. Messages never echo what was read. */
export class HostKeyError extends Error {
  constructor(readonly code: HostKeyErrorCode) {
    super(
      code === 'missing'
        ? 'master key missing: stdin closed before its second line'
        : code === 'invalid'
          ? 'master key invalid: the second line of stdin must be 43 base64url characters (32 bytes)'
          : 'master key missing: no second line on stdin in time',
    )
    this.name = 'HostKeyError'
  }
}

const REDACTED = '[redacted master key]'

/**
 * The master key the desktop host sent. Holds the bytes in a private field, so logging,
 * serializing or inspecting it shows nothing. `encoded()` is the base64url form, for the log
 * redactor only; `take()` hands the bytes over once, and the caller zeroes them.
 */
export class HostMasterKey {
  #bytes: Uint8Array | undefined
  readonly #encoded: string

  constructor(bytes: Uint8Array, encoded: string) {
    this.#bytes = bytes
    this.#encoded = encoded
  }

  encoded(): string {
    return this.#encoded
  }

  take(): Uint8Array {
    const bytes = this.#bytes
    if (!bytes) throw new Error('the master key was already taken')
    this.#bytes = undefined
    return bytes
  }

  toJSON(): string {
    return REDACTED
  }

  toString(): string {
    return REDACTED
  }

  [inspect.custom](): string {
    return REDACTED
  }
}

export interface ReadHostKeyOptions {
  timeoutMs?: number
}

/**
 * Reads the master key from the line after the launch token: 43 base64url characters that decode
 * to exactly 32 bytes in canonical form, then a newline. Bounded by `timeoutMs` from the call.
 * Every byte buffer it handled is zero-filled; on any failure nothing of the line is kept.
 */
export async function readHostMasterKey(
  launch: LaunchToken,
  { timeoutMs = HOST_KEY_TIMEOUT_MS }: ReadHostKeyOptions = {},
): Promise<HostMasterKey> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const outcome = await Promise.race([launch.remainderReady.then(() => 'ready' as const), timedOut])
  clearTimeout(timer)
  const bytes = launch.takeRemainder()
  try {
    if (outcome === 'timeout') throw new HostKeyError('timeout')
    const newline = bytes.indexOf(0x0a)
    if (newline === -1) {
      // A full buffer without a newline is a runaway line, not a key cut short.
      throw new HostKeyError(bytes.length > KEY_LINE_MAX ? 'invalid' : 'missing')
    }
    let end = newline
    if (end > 0 && bytes[end - 1] === 0x0d) end--
    const line = bytes.subarray(0, end)
    if (line.length !== 43 || !KEY_LINE.test(line.toString('latin1'))) {
      throw new HostKeyError('invalid')
    }
    const encoded = line.toString('latin1')
    const decoded = Buffer.from(encoded, 'base64url')
    if (decoded.length !== MASTER_KEY_BYTES || decoded.toString('base64url') !== encoded) {
      decoded.fill(0)
      throw new HostKeyError('invalid')
    }
    const key = new Uint8Array(decoded)
    decoded.fill(0)
    return new HostMasterKey(key, encoded)
  } finally {
    bytes.fill(0)
  }
}
