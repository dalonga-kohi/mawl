import { describe, expect, it, vi } from 'vitest'
import { ART } from './glyphs.tsx'
import { GAZES, type GazeName, type LifeClock, projectEye, startIdleLife } from './idle-life.ts'

/** A clock on vitest's fake timers with a scripted random sequence. */
function clock(randoms: number[]): LifeClock {
  let i = 0
  return {
    random: () => randoms[i++ % randoms.length] ?? 0,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }
}

function run(randoms: number[], opts: { quiet?: boolean; look?: boolean; blink?: boolean } = {}) {
  const gazes: GazeName[] = []
  const blinks: boolean[] = []
  const stop = startIdleLife(
    clock(randoms),
    { onGaze: (g) => gazes.push(g), onBlink: (closed) => blinks.push(closed) },
    opts,
  )
  return { gazes, blinks, stop }
}

describe('startIdleLife', () => {
  it('looks somewhere after 2 to 5 s, holds, then comes back to the centre', () => {
    vi.useFakeTimers()
    try {
      // 0.99 picks the last, rarest target (up-right); 0 gives the shortest waits.
      const { gazes, stop } = run([0, 0.99, 0], { blink: false })
      vi.advanceTimersByTime(1999)
      expect(gazes).toEqual([])
      vi.advanceTimersByTime(1)
      expect(gazes).toEqual(['upRight'])
      vi.advanceTimersByTime(599)
      expect(gazes).toEqual(['upRight'])
      vi.advanceTimersByTime(1)
      expect(gazes).toEqual(['upRight', 'centre'])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('never waits longer than 5 s between looks and never holds longer than 1.8 s', () => {
    vi.useFakeTimers()
    try {
      const { gazes, stop } = run([0.999999, 0.5, 0.999999], { blink: false })
      vi.advanceTimersByTime(5000)
      expect(gazes.length).toBe(1)
      vi.advanceTimersByTime(1800)
      expect(gazes.at(-1)).toBe('centre')
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('blinks every 3 to 6 s, closing for 120 ms, sometimes twice', () => {
    vi.useFakeTimers()
    try {
      // First blink single (0.9 >= double chance), second double (0.0).
      const { blinks, stop } = run([0, 0.9, 0, 0], { look: false })
      vi.advanceTimersByTime(3000)
      expect(blinks).toEqual([true])
      vi.advanceTimersByTime(120)
      expect(blinks).toEqual([true, false])
      vi.advanceTimersByTime(3000)
      expect(blinks).toEqual([true, false, true])
      vi.advanceTimersByTime(120 + 120 + 120)
      expect(blinks).toEqual([true, false, true, false, true, false])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops every timer when stopped', () => {
    vi.useFakeTimers()
    try {
      const { gazes, blinks, stop } = run([0, 0.99, 0])
      stop()
      vi.advanceTimersByTime(60_000)
      expect(gazes).toEqual([])
      expect(blinks).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('looks around more rarely when quiet', () => {
    vi.useFakeTimers()
    try {
      const { gazes, stop } = run([0, 0.99, 0], { quiet: true, blink: false })
      vi.advanceTimersByTime(2000)
      expect(gazes).toEqual([])
      stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('looks at the centre most often', () => {
    const weights = Object.values(GAZES).map((g) => g.weight)
    expect(GAZES.centre.weight).toBe(Math.max(...weights))
  })
})

describe('projectEye', () => {
  const home = { l: ART.cx - ART.eyeX, r: ART.cx + ART.eyeX }

  it('rests each eye on its home spot at full scale', () => {
    for (const side of ['l', 'r'] as const) {
      const e = projectEye(side, 0, 0)
      expect(e.x).toBeCloseTo(home[side], 5)
      expect(e.y).toBeCloseTo(ART.eyeY, 5)
      expect(e.sx).toBeCloseTo(1, 5)
      expect(e.sy).toBeCloseTo(1, 5)
    }
  })

  it('turns like a sphere: the leading eye squashes and reaches past the edge, the trailing one closes in', () => {
    const { yaw } = GAZES.right
    const lead = projectEye('r', yaw, 0)
    const trail = projectEye('l', yaw, 0)
    expect(lead.sx).toBeLessThan(trail.sx)
    expect(lead.sx).toBeLessThan(1)
    expect(lead.x - trail.x).toBeLessThan(2 * ART.eyeX)
    // The leading glyph's centre sits beyond the orb outline at its height, so the clip cuts it.
    const edge = ART.cx + Math.sqrt(ART.r ** 2 - (lead.y - ART.cy) ** 2)
    expect(lead.x).toBeGreaterThan(edge - 4)
  })

  it('moves both eyes up for an upward gaze and flattens them a little', () => {
    const up = projectEye('l', 0, GAZES.upLeft.pitch)
    expect(up.y).toBeLessThan(ART.eyeY)
    expect(up.sy).toBeLessThan(1)
    expect(up.sy).toBeGreaterThan(0.8)
  })
})
