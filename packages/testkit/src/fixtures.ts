/** Deterministic id generator: `seq('run')` yields run_1, run_2, ... */
export function seq(prefix = 'id'): () => string {
  let n = 0
  return () => `${prefix}_${++n}`
}

export interface FixedClock {
  now(): Date
  advance(ms: number): void
}

/** A frozen clock for fake time. Time only moves when `advance` is called. */
export function fixedClock(iso: string): FixedClock {
  let t = Date.parse(iso)
  if (Number.isNaN(t)) throw new Error(`fixedClock: invalid ISO date "${iso}"`)
  return {
    now: () => new Date(t),
    advance: (ms) => {
      t += ms
    },
  }
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
