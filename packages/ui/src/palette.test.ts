import { converter, formatHex, interpolate, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import * as palette from './palette.ts'
import {
  accentPresets,
  defaultAccent,
  ink,
  mawlAccent,
  neutrals,
  retiredAccentPresets,
  secondary,
  semantic,
  type ThemeName,
} from './palette.ts'

const themes: ThemeName[] = ['light', 'dark']

describe('neutral palette', () => {
  for (const theme of themes) {
    const n = neutrals[theme]
    for (const [bgName, bg] of [
      ['bg', n.bg],
      ['surface', n.surface],
      ['surface-2', n.surface2],
    ] as const) {
      it(`${theme}: text, text-2 and text-3 reach 4.5:1 on ${bgName}`, () => {
        expect(wcagContrast(n.text, bg)).toBeGreaterThanOrEqual(4.5)
        expect(wcagContrast(n.text2, bg)).toBeGreaterThanOrEqual(4.5)
        expect(wcagContrast(n.text3, bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
    it(`${theme}: text-3 stays quieter than text-2`, () => {
      expect(wcagContrast(n.text3, n.surface)).toBeLessThan(wcagContrast(n.text2, n.surface))
    })
  }

  it('uses the Mawl palette: bg, sidebar as surface-2, card as surface, and both texts', () => {
    expect(neutrals.light).toMatchObject({
      bg: '#F5F7FC',
      surface: '#FFFFFF',
      surface2: '#EBEFF7',
      text: '#1B2432',
      text2: '#58677D',
    })
    expect(neutrals.dark).toMatchObject({
      bg: '#0B1019',
      surface: '#1B2433',
      surface2: '#121926',
      text: '#F2F5FC',
      text2: '#A7B2C4',
    })
  })

  it('reads deep navy in dark mode: bg under OKLCH L 0.2 with a blue hue', () => {
    const toOklch = converter('oklch')
    const bg = toOklch(neutrals.dark.bg)
    expect(bg?.l).toBeLessThan(0.2)
    expect(bg?.h).toBeGreaterThan(230)
    expect(bg?.h).toBeLessThan(280)
  })

  it('uses the light text color as the ink on light accent fills', () => {
    expect(ink).toBe(neutrals.light.text)
  })
})

describe('semantic colors', () => {
  for (const theme of themes) {
    for (const name of ['ok', 'warn', 'danger'] as const) {
      it(`${theme}: ${name} used as text reaches 4.5:1 on surface`, () => {
        expect(wcagContrast(semantic[theme][name], neutrals[theme].surface)).toBeGreaterThanOrEqual(
          4.5,
        )
      })
    }
  }
})

// Mirrors `color-mix(in oklab, var(--x) 12%, var(--surface))` from tokens.css.
const softTint = (fg: string, surface: string) =>
  formatHex(interpolate([surface, fg], 'oklab')(0.12))

describe('semantic text on its own soft tint', () => {
  for (const theme of themes) {
    for (const name of ['ok', 'warn', 'danger'] as const) {
      it(`${theme}: ${name} text on ${name}-soft reaches 4.5:1`, () => {
        const fg = semantic[theme][name]
        const tint = softTint(fg, neutrals[theme].surface)
        expect(wcagContrast(fg, tint)).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})

describe('secondary teal', () => {
  it('uses the Mawl teal per theme', () => {
    expect(secondary.light.secondary).toBe('#087F86')
    expect(secondary.dark.secondary).toBe('#80DACE')
  })

  for (const theme of themes) {
    const n = neutrals[theme]
    it(`${theme}: secondary reaches 3:1 as a UI color on bg, surface and surface-2`, () => {
      for (const bg of [n.bg, n.surface, n.surface2]) {
        expect(wcagContrast(secondary[theme].secondary, bg), bg).toBeGreaterThanOrEqual(3)
      }
    })
    it(`${theme}: secondary-ink reaches 4.5:1 on bg, surface, surface-2 and its soft tint`, () => {
      const s = secondary[theme].secondaryInk
      const tint = softTint(secondary[theme].secondary, n.surface)
      for (const bg of [n.bg, n.surface, n.surface2, tint]) {
        expect(wcagContrast(s, bg), bg).toBeGreaterThanOrEqual(4.5)
      }
    })
  }
})

describe('the Mawl primary', () => {
  it('is #7950E8 with white text, the same fill in both themes', () => {
    expect(mawlAccent.hex).toBe('#7950E8')
    expect(wcagContrast('#FFFFFF', mawlAccent.hex)).toBeGreaterThanOrEqual(5)
  })

  it('has the hand-picked accent ink per theme, at 4.5:1 on every neutral', () => {
    expect(mawlAccent.ink).toEqual({ light: '#5E32C5', dark: '#BDA4ED' })
    for (const theme of themes) {
      const n = neutrals[theme]
      for (const bg of [n.bg, n.surface, n.surface2]) {
        expect(wcagContrast(mawlAccent.ink[theme], bg), `${theme} ${bg}`).toBeGreaterThanOrEqual(
          4.5,
        )
      }
    }
  })
})

describe('presets', () => {
  it('lists Mawl first, then the soft presets, and makes Mawl the default', () => {
    expect(accentPresets.map((p) => p.name)).toEqual([
      'Mawl',
      'Sky',
      'Peach',
      'Lilac',
      'Rose',
      'Slate',
    ])
    expect(defaultAccent).toEqual({ id: 'mawl', name: 'Mawl', hex: '#7950E8' })
  })

  it('keeps every preset after Mawl soft: a light color that takes ink text on its fill', () => {
    const toOklch = converter('oklch')
    for (const p of accentPresets.slice(1)) {
      expect(toOklch(p.hex)?.l, p.name).toBeGreaterThanOrEqual(0.8)
      expect(wcagContrast(p.hex, ink), p.name).toBeGreaterThanOrEqual(6)
    }
  })

  it('retires Lime with the older presets, none of which collide with a live preset', () => {
    expect(retiredAccentPresets.map((p) => p.name)).toEqual([
      'Lake',
      'Moss',
      'Amber',
      'Coral',
      'Plum',
      'Slate',
      'Lime',
    ])
    const live = new Set<string>(accentPresets.map((p) => p.hex))
    for (const p of retiredAccentPresets) expect(live.has(p.hex), p.name).toBe(false)
  })

  it('no longer carries the beaver or lime mascot colors', () => {
    expect('mascot' in palette).toBe(false)
  })
})
