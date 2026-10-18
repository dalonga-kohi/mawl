import type { ProfileId, RunId } from '@faire/contracts'
import { realTimers, type TimerPort } from './timers.ts'

/** At most one delta per run in this window. */
export const DELTA_WINDOW_MS = 50

export interface DeltaOut {
  profileId: ProfileId
  runId: RunId
  stepIdx: number
  text: string
}

/** What the run job needs from a coalescer: feed tokens, flush at the end. */
export interface DeltaSink {
  add(delta: DeltaOut): void
  flush(runId: RunId): void
}

export interface DeltaCoalescer extends DeltaSink {
  /** Flushes every run and stops accepting tokens. */
  close(): void
}

interface Pending extends DeltaOut {
  timer: unknown
}

/**
 * Tokens arrive far faster than a UI can paint. This batches the text of each run into at most
 * one delta per {@link DELTA_WINDOW_MS}, which keeps the socket and the client cheap.
 */
export function createDeltaCoalescer(options: {
  publish: (delta: DeltaOut) => void
  windowMs?: number
  timers?: TimerPort
}): DeltaCoalescer {
  const windowMs = options.windowMs ?? DELTA_WINDOW_MS
  const timers = options.timers ?? realTimers
  const pending = new Map<RunId, Pending>()
  let closed = false

  function flush(runId: RunId): void {
    const p = pending.get(runId)
    if (!p) return
    pending.delete(runId)
    timers.clearTimeout(p.timer)
    options.publish({
      profileId: p.profileId,
      runId: p.runId,
      stepIdx: p.stepIdx,
      text: p.text,
    })
  }

  return {
    add(delta) {
      if (closed || delta.text === '') return
      const current = pending.get(delta.runId)
      if (current && current.stepIdx !== delta.stepIdx) flush(delta.runId)
      const existing = pending.get(delta.runId)
      if (existing) {
        existing.text += delta.text
        return
      }
      const entry: Pending = { ...delta, timer: undefined }
      entry.timer = timers.setTimeout(() => flush(delta.runId), windowMs)
      pending.set(delta.runId, entry)
    },
    flush,
    close() {
      for (const runId of [...pending.keys()]) flush(runId)
      closed = true
    },
  }
}
