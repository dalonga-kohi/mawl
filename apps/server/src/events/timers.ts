/** Timer functions the bus and coalescer use, so tests can drive time by hand. */
export interface TimerPort {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const realTimers: TimerPort = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** Backoff for reconnects: `baseMs` doubling to `maxMs`, plus up to 25 percent jitter. */
export function backoffDelay(
  attempt: number,
  random: () => number,
  baseMs: number,
  maxMs: number,
): number {
  const delay = Math.min(maxMs, baseMs * 2 ** attempt)
  return Math.round(delay + random() * delay * 0.25)
}
