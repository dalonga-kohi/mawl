import type { Readable } from 'node:stream'

/**
 * The per-launch token the desktop host writes as stdin's first line (never argv or env, which
 * other processes on the machine can read). Base64url, as the host generates it from random bytes.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/
/** Bytes buffered while waiting for the first newline; anything longer is not a token. */
const MAX_LINE_BYTES = 1024
export const LAUNCH_TOKEN_TIMEOUT_MS = 15_000
/**
 * Bytes kept of the line after the token (the master key, D1.6), its newline included. A line
 * that does not end within them is not a key; more bytes are dropped.
 */
export const MAX_REMAINDER_BYTES = 1024

export type LaunchTokenErrorCode = 'missing' | 'invalid' | 'timeout'

/** Messages describe what went wrong, never what was read. */
export class LaunchTokenError extends Error {
  constructor(readonly code: LaunchTokenErrorCode) {
    super(
      code === 'missing'
        ? 'launch token missing: stdin closed before its first line'
        : code === 'invalid'
          ? 'launch token invalid: the first line of stdin must be 32-512 base64url characters'
          : 'launch token missing: no first line on stdin in time',
    )
    this.name = 'LaunchTokenError'
  }
}

export interface ReadLaunchTokenOptions {
  timeoutMs?: number
  /**
   * The parent watchdog: called once when stdin ends, closes or errors after a valid token, which
   * means the host died or let go of the server. Never called when the token was rejected.
   */
  onParentGone?: () => void
}

export interface LaunchToken {
  token: string
  /**
   * Settles once the line after the token is complete (its newline arrived), MAX_REMAINDER_BYTES
   * arrived without one, stdin ended, or takeRemainder() was called. Never rejects; it has no
   * timeout of its own (the key reader adds one).
   */
  remainderReady: Promise<void>
  /**
   * One-shot: hands over the bytes of the line after the token (newline included when it came),
   * up to MAX_REMAINDER_BYTES, then zero-fills the internal copy and stops buffering. Later calls
   * return an empty buffer. The bytes are the master key: the caller zeroes them, never logs them.
   */
  takeRemainder(): Buffer
}

/** Tests only: the internal remainder buffer, to prove takeRemainder() zero-fills it. */
const internals = new WeakMap<LaunchToken, Buffer>()
export function __internalRemainderOf(launch: LaunchToken): Buffer | undefined {
  return internals.get(launch)
}

/** Joins two buffers into a new one and zero-fills both: no stray copy of a secret is left. */
function joinAndWipe(a: Buffer, b: Buffer): Buffer {
  const joined = Buffer.concat([a, b])
  a.fill(0)
  b.fill(0)
  return joined
}

/**
 * Reads the token from the first line of `input` (it must end with a newline; a token then EOF
 * is `missing`), then keeps the next line (the master key) and keeps the stream flowing
 * afterwards, so its end is seen. One set of listeners watches the whole stream, so an end in the
 * same chunk as the token is not missed between reading and watching. Every stdin chunk is
 * zero-filled once its bytes are copied out, since it carried the token or the key.
 */
export function readLaunchToken(
  input: Readable,
  { timeoutMs = LAUNCH_TOKEN_TIMEOUT_MS, onParentGone }: ReadLaunchTokenOptions = {},
): Promise<LaunchToken> {
  return new Promise((resolve, reject) => {
    let state: 'reading' | 'watching' | 'done' = 'reading'
    let buffered: Buffer = Buffer.alloc(0)

    const fail = (code: LaunchTokenErrorCode) => {
      if (state !== 'reading') return
      state = 'done'
      clearTimeout(timer)
      buffered.fill(0)
      buffered = Buffer.alloc(0)
      input.off('data', onData)
      reject(new LaunchTokenError(code))
    }

    // The line after the token, in a fixed buffer so growing it leaves no copies behind.
    const rest = Buffer.alloc(MAX_REMAINDER_BYTES)
    let restLength = 0
    // Set once the key line is complete, capped, taken, or stdin ended: nothing more is kept.
    let restSettled = false
    let settleRest!: () => void
    const remainderReady = new Promise<void>((done) => {
      settleRest = () => {
        restSettled = true
        done()
      }
    })
    const keep = (bytes: Buffer) => {
      if (restSettled) return
      const newline = bytes.indexOf(0x0a)
      const wanted = newline === -1 ? bytes.length : newline + 1
      const room = MAX_REMAINDER_BYTES - restLength
      const copied = bytes.copy(rest, restLength, 0, Math.min(wanted, room))
      restLength += copied
      if (newline !== -1 || restLength >= MAX_REMAINDER_BYTES) settleRest()
    }

    const takeRemainder = () => {
      const out = Buffer.from(rest.subarray(0, restLength))
      rest.fill(0)
      restLength = 0
      settleRest()
      return out
    }

    const onData = (raw: Buffer | string) => {
      const chunk = typeof raw === 'string' ? Buffer.from(raw) : raw
      try {
        if (state === 'watching') {
          keep(chunk)
          return
        }
        if (state !== 'reading') return
        buffered = joinAndWipe(buffered, Buffer.from(chunk))
        const newline = buffered.indexOf(0x0a)
        if (newline === -1) {
          if (buffered.length > MAX_LINE_BYTES) fail('invalid')
          return
        }
        const line = buffered.subarray(0, newline).toString('utf8').replace(/\r$/, '')
        const after = buffered.subarray(newline + 1)
        if (!TOKEN_PATTERN.test(line)) {
          fail('invalid')
          return
        }
        state = 'watching'
        clearTimeout(timer)
        keep(after)
        buffered.fill(0)
        buffered = Buffer.alloc(0)
        const launch: LaunchToken = { token: line, remainderReady, takeRemainder }
        internals.set(launch, rest)
        resolve(launch)
      } finally {
        chunk.fill(0)
      }
    }

    const onGone = () => {
      if (state === 'reading') {
        fail('missing')
        return
      }
      if (state !== 'watching') return
      state = 'done'
      input.off('data', onData)
      if (!restSettled) settleRest()
      onParentGone?.()
    }

    const timer = setTimeout(() => fail('timeout'), timeoutMs)
    input.on('data', onData)
    input.on('end', onGone)
    input.on('close', onGone)
    // An error is the parent going away too; a listener also keeps it from crashing the process.
    input.on('error', onGone)
    input.resume()
  })
}
