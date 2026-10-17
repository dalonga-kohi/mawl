import { converter, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import { applyAccent, deriveAccent, InvalidColorError } from './accent.ts'
import { accentPresets, neutrals, type ThemeName } from './palette.ts'

const toOklch = converter('oklch')
const themes: ThemeName[] = ['light', 'dark']
const HEX = /^#[0-9a-f]{6}$/i

/** Deterministic PRNG (mulberry32), so failures are reproducible. */
function prng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function expectAccessible(hex: string, theme: ThemeName) {
  const s = deriveAccent(hex, theme)
  for (const value of Object.values(s)) expect(value).toMatch(HEX)
  expect(
    wcagContrast(s.onAccent, s.accentFill),
    `${hex} ${theme} onAccent/fill`,
  ).toBeGreaterThanOrEqual(4.5)
  expect(
    wcagContrast(s.accentInk, neutrals[theme].surface),
    `${hex} ${theme} ink/surface`,
  ).toBeGreaterThanOrEqual(4.5)
}

describe('deriveAccent contrast guarantees', () => {
  for (const preset of accentPresets) {
    for (const theme of themes) {
      it(`${preset.name} ${theme}: on-accent and accent-ink reach 4.5:1`, () => {
        expectAccessible(preset.hex, theme)
      })
    }
  }

  it('holds for 300 pseudo-random colors in both themes', () => {
    const rand = prng(20260617)
    for (let i = 0; i < 300; i++) {
      const hex = `#${Math.floor(rand() * 0x1000000)
        .toString(16)
        .padStart(6, '0')}`
      for (const theme of themes) expectAccessible(hex, theme)
    }
  })

  it('holds for the extremes', () => {
    for (const hex of ['#000000', '#FFFFFF', '#FFFF00', '#0000FF', '#808080']) {
      for (const theme of themes) expectAccessible(hex, theme)
    }
  })
})

describe('deriveAccent shape', () => {
  it('darkens Lake into a fill near #2B6FE6 that keeps the hue and takes white text', () => {
    const s = deriveAccent('#3D8BFD', 'light')
    expect(s.onAccent.toLowerCase()).toBe('#ffffff')
    expect(wcagContrast('#ffffff', s.accentFill)).toBeGreaterThanOrEqual(4.5)
    const base = toOklch('#3D8BFD')
    const fill = toOklch(s.accentFill)
    expect(base?.h).toBeDefined()
    expect(Math.abs((fill?.h ?? 0) - (base?.h ?? 0))).toBeLessThanOrEqual(5)
    expect(fill?.l).toBeLessThan(base?.l ?? 0)
    // DESIGN says about #2B6FE6 (4.65:1); the engine must stay close, not be exact.
    expect(wcagContrast(s.accentFill, '#2B6FE6')).toBeLessThan(1.3)
  })

  it('keeps a light base like Amber and switches the text to ink', () => {
    const s = deriveAccent('#E09A1E', 'light')
    expect(s.accentFill.toLowerCase()).toBe('#e09a1e')
    expect(s.onAccent.toLowerCase()).toBe('#17202b')
  })

  it('raises the dark-theme base to OKLCH L >= 0.68', () => {
    for (const preset of accentPresets) {
      expect(toOklch(deriveAccent(preset.hex, 'dark').accent)?.l).toBeGreaterThanOrEqual(0.68)
    }
    expect(toOklch(deriveAccent('#102030', 'dark').accent)?.l).toBeGreaterThanOrEqual(0.68)
  })

  it('does not change a base that is already bright enough in dark', () => {
    expect(deriveAccent('#E09A1E', 'dark').accent.toLowerCase()).toBe('#e09a1e')
  })

  it('makes hover 4% and press 8% darker than the fill in OKLCH L', () => {
    const s = deriveAccent('#3FA36B', 'light')
    const fill = toOklch(s.accentFill)?.l ?? 0
    expect(fill - (toOklch(s.accentHover)?.l ?? 0)).toBeCloseTo(0.04, 2)
    expect(fill - (toOklch(s.accentPress)?.l ?? 0)).toBeCloseTo(0.08, 2)
  })

  it('accepts #rgb shorthand and any case', () => {
    expect(deriveAccent('#38F', 'light')).toEqual(deriveAccent('#3388FF', 'light'))
    expect(deriveAccent('#3d8bfd', 'light')).toEqual(deriveAccent('#3D8BFD', 'light'))
  })
})

describe('deriveAccent input validation', () => {
  for (const bad of ['nope', '#12', '', '3D8BFD', '#12345g', '#1234567']) {
    it(`throws InvalidColorError for ${JSON.stringify(bad)}`, () => {
      expect(() => deriveAccent(bad, 'light')).toThrow(InvalidColorError)
    })
  }
})

describe('applyAccent', () => {
  it('sets exactly the six accent variables on a style-like target', () => {
    const calls = new Map<string, string>()
    const scale = applyAccent('#3D8BFD', 'light', {
      setProperty: (name, value) => {
        calls.set(name, value)
      },
    })
    expect([...calls.keys()].sort()).toEqual([
      '--accent',
      '--accent-fill',
      '--accent-hover',
      '--accent-ink',
      '--accent-press',
      '--on-accent',
    ])
    expect(calls.get('--accent-fill')).toBe(scale.accentFill)
    expect(calls.get('--on-accent')).toBe(scale.onAccent)
    expect(calls.get('--accent-ink')).toBe(scale.accentInk)
  })

  it('throws before touching the target for an invalid color', () => {
    let touched = false
    expect(() =>
      applyAccent('nope', 'dark', {
        setProperty: () => {
          touched = true
        },
      }),
    ).toThrow(InvalidColorError)
    expect(touched).toBe(false)
  })
})
