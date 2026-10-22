import type { Readable } from 'node:stream'

/**
 * The per-launch token the desktop host writes as stdin's first line (never argv or env, which
 * other processes on the machine can read). Base64url, as the host generates it from random bytes.
 */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,512}$/
/** Bytes buffered while waiting for the first newline; anything longer is not a token. */
const MAX_LINE_BYTES = 1024
export const LAUNCH_TOKEN_TIMEOUT_MS = 15_000

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

/**
 * Reads the token from the first line of `input` and keeps the stream flowing afterwards, so its
 * end is seen. Later lines are ignored for now (reserved for the host, e.g. D1.6's master key).
 * One set of listeners watches the whole stream, so an end in the same chunk as the token is not
 * missed between reading and watching.
 */
export function readLaunchToken(
  input: Readable,
  { timeoutMs = LAUNCH_TOKEN_TIMEOUT_MS, onParentGone }: ReadLaunchTokenOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    let state: 'reading' | 'watching' | 'done' = 'reading'
    let buffered = Buffer.alloc(0)

    const fail = (code: LaunchTokenErrorCode) => {
      if (state !== 'reading') return
      state = 'done'
      clearTimeout(timer)
      buffered = Buffer.alloc(0)
      input.off('data', onData)
      reject(new LaunchTokenError(code))
    }

    const onData = (chunk: Buffer | string) => {
      if (state !== 'reading') return
      buffered = Buffer.concat([buffered, typeof chunk === 'string' ? Buffer.from(chunk) : chunk])
      const newline = buffered.indexOf(0x0a)
      if (newline === -1) {
        if (buffered.length > MAX_LINE_BYTES) fail('invalid')
        return
      }
      const line = buffered.subarray(0, newline).toString('utf8').replace(/\r$/, '')
      buffered = Buffer.alloc(0)
      if (!TOKEN_PATTERN.test(line)) {
        fail('invalid')
        return
      }
      state = 'watching'
      clearTimeout(timer)
      // Still flowing with no data listener: later bytes are discarded and the end still fires.
      input.off('data', onData)
      resolve(line)
    }

    const onGone = () => {
      if (state === 'reading') {
        fail('missing')
        return
      }
      if (state !== 'watching') return
      state = 'done'
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
