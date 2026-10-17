import { describe, expect, it } from 'vitest'
import { fixedClock, seededRandom, seq } from './fixtures'

describe('seq', () => {
  it('yields deterministic ids with a prefix and a counter', () => {
    const next = seq('run')
    expect([next(), next(), next()]).toEqual(['run_1', 'run_2', 'run_3'])
  })

  it('keeps independent counters per generator', () => {
    const a = seq('a')
    const b = seq('b')
    a()
    expect(b()).toBe('b_1')
  })
})

describe('fixedClock', () => {
  it('returns the frozen instant until advanced', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:00.000Z')
  })

  it('advances by the given milliseconds', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z')
    clock.advance(90_000)
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z')
  })

  it('does not let callers mutate its state through the returned date', () => {
    const clock = fixedClock('2026-01-01T00:00:00.000Z')
    clock.now().setFullYear(1999)
    expect(clock.now().getUTCFullYear()).toBe(2026)
  })

  it('rejects an invalid ISO string', () => {
    expect(() => fixedClock('nope')).toThrow(/invalid/i)
  })
})

describe('seededRandom', () => {
  it('produces the same sequence for the same seed', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('produces different sequences for different seeds', () => {
    expect(seededRandom(1)()).not.toBe(seededRandom(2)())
  })

  it('stays within [0, 1)', () => {
    const r = seededRandom(7)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('matches the known mulberry32 value for seed 1', () => {
    expect(seededRandom(1)()).toBeCloseTo(0.6270739405881613, 12)
  })
})
