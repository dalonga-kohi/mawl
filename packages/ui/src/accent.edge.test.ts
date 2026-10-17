import { converter, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import { applyAccent, deriveAccent, InvalidColorError } from './accent.ts'
import { accentPresets, neutrals, type ThemeName } from './palette.ts'

const toOklch = converter('oklch')
const themes: ThemeName[] = ['light', 'dark']
const HEX6 = /^#[0-9a-f]{6}$/i

function prng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const extremes = [
  '#000000',
  '#FFFFFF',
  '#808080',
  '#FFFF66',
  '#0A0F3C',
  '#FF0000',
  '#00FF00',
  '#0af',
  '#0AF',
]

function hueDelta(a: number, b: number) {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

describe('deriveAccent extreme inputs', () => {
  for (const hex of extremes) {
    for (const theme of themes) {
      it(`${hex} ${theme}: valid hex, 4.5:1 for on-accent and accent-ink`, () => {
        const s = deriveAccent(hex, theme)
        for (const v of Object.values(s)) expect(v).toMatch(HEX6)
        expect(wcagContrast(s.onAccent, s.accentFill)).toBeGreaterThanOrEqual(4.5)
        expect(wcagContrast(s.accentInk, neutrals[theme].surface)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }

  it('keeps dark accent lightness >= 0.68 even for black and navy', () => {
    for (const hex of ['#000000', '#0A0F3C', '#808080']) {
      expect(toOklch(deriveAccent(hex, 'dark').accent)?.l).toBeGreaterThanOrEqual(0.68)
    }
  })

  it('treats #0af and #00AAFF as the same input in both themes', () => {
    for (const theme of themes) {
      expect(deriveAccent('#0af', theme)).toEqual(deriveAccent('#00AAFF', theme))
      expect(deriveAccent('#0AF', theme)).toEqual(deriveAccent('#00aaff', theme))
    }
  })

  it('keeps grey neutral (chroma ~0) through the whole scale', () => {
    for (const theme of themes) {
      for (const v of Object.values(deriveAccent('#808080', theme))) {
        const chroma = (toOklch(v as string) as { c?: number } | undefined)?.c ?? 0
        expect(chroma).toBeLessThan(0.02)
      }
    }
  })

  it('preserves hue within 12 degrees for chromatic inputs in the fill, hover, press and ink', () => {
    const colors = ['#FF0000', '#00FF00', '#0AF', '#FFFF66', ...accentPresets.map((p) => p.hex)]
    for (const hex of colors) {
      const baseH = toOklch(hex)?.h ?? 0
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        for (const key of ['accentFill', 'accentHover', 'accentPress', 'accentInk'] as const) {
          const c = toOklch(s[key])
          // hex rounding at very low or very high lightness can wobble hue; allow a margin
          expect(hueDelta(c?.h ?? 0, baseH), `${hex} ${theme} ${key}`).toBeLessThanOrEqual(12)
        }
      }
    }
  })
})

describe('onAccent contrast on hover and press states', () => {
  it('reaches 4.5:1 on accentHover and accentPress for every preset in both themes', () => {
    for (const preset of accentPresets) {
      for (const theme of themes) {
        const s = deriveAccent(preset.hex, theme)
        expect(
          wcagContrast(s.onAccent, s.accentHover),
          `${preset.name} ${theme} hover`,
        ).toBeGreaterThanOrEqual(4.5)
        expect(
          wcagContrast(s.onAccent, s.accentPress),
          `${preset.name} ${theme} press`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('reaches 4.5:1 on accentHover and accentPress for 300 pseudo-random colors', () => {
    const rand = prng(20260617)
    const failures: string[] = []
    for (let i = 0; i < 300; i++) {
      const hex = `#${Math.floor(rand() * 0x1000000)
        .toString(16)
        .padStart(6, '0')}`
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        for (const key of ['accentHover', 'accentPress'] as const) {
          const c = wcagContrast(s.onAccent, s[key])
          if (c < 4.5) failures.push(`${hex} ${theme} ${key} ${c.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('reaches 4.5:1 on hover and press for the extremes', () => {
    const failures: string[] = []
    for (const hex of extremes) {
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        for (const key of ['accentHover', 'accentPress'] as const) {
          const c = wcagContrast(s.onAccent, s[key])
          if (c < 4.5) failures.push(`${hex} ${theme} ${key} ${c.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('determinism and applyAccent', () => {
  it('returns identical output for identical input', () => {
    for (const hex of extremes) {
      for (const theme of themes) {
        expect(deriveAccent(hex, theme)).toEqual(deriveAccent(hex, theme))
      }
    }
  })

  it('applyAccent writes the derived values for extreme inputs and returns the scale', () => {
    for (const hex of extremes) {
      for (const theme of themes) {
        const calls = new Map<string, string>()
        const scale = applyAccent(hex, theme, { setProperty: (n, v) => void calls.set(n, v) })
        expect(scale).toEqual(deriveAccent(hex, theme))
        expect(calls.size).toBe(6)
        for (const v of calls.values()) expect(v).toMatch(HEX6)
      }
    }
  })

  it('applyAccent can be re-applied on theme flip and overwrites every variable', () => {
    const calls = new Map<string, string>()
    const target = { setProperty: (n: string, v: string) => void calls.set(n, v) }
    applyAccent('#3D8BFD', 'light', target)
    const light = new Map(calls)
    applyAccent('#3D8BFD', 'dark', target)
    expect(calls.get('--accent')).not.toBe(light.get('--accent'))
    expect(calls.get('--accent-ink')).not.toBe(light.get('--accent-ink'))
  })
})

describe('input strictness', () => {
  for (const bad of [
    ' #3D8BFD',
    '#3D8BFD ',
    '\n#3D8BFD',
    '3D8BFD',
    '38F',
    '#3D8BFDFF',
    '#38FF',
    'rgb(1,2,3)',
  ]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      expect(() => deriveAccent(bad, 'light')).toThrow(InvalidColorError)
    })
  }

  it('rejects non-string input', () => {
    for (const bad of [undefined, null, 0x3d8bfd, {}]) {
      expect(() => deriveAccent(bad as unknown as string, 'light')).toThrow(InvalidColorError)
    }
  })
})
