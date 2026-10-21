import { converter, formatHex, interpolate, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import {
  accentPresets,
  defaultAccent,
  ink,
  mascot,
  neutrals,
  retiredAccentPresets,
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
    ] as const) {
      it(`${theme}: text and text-2 reach 4.5:1 on ${bgName}`, () => {
        expect(wcagContrast(n.text, bg)).toBeGreaterThanOrEqual(4.5)
        expect(wcagContrast(n.text2, bg)).toBeGreaterThanOrEqual(4.5)
      })
    }
    it(`${theme}: text-3 (non-body use) reaches 3:1 on surface`, () => {
      expect(wcagContrast(n.text3, n.surface)).toBeGreaterThanOrEqual(3)
    })
  }

  it('uses the UI-REDESIGN Cream and Ink values', () => {
    expect(neutrals.light).toEqual({
      bg: '#FAF8F4',
      surface: '#FFFFFF',
      surface2: '#F2EFE8',
      line: '#E7E3DA',
      text: '#1D1B16',
      text2: '#5E5A50',
      text3: '#8C877B',
    })
    expect(neutrals.dark).toEqual({
      bg: '#060607',
      surface: '#0D0D0F',
      surface2: '#151517',
      line: '#1E1E22',
      text: '#ECECEE',
      text2: '#A6A6AD',
      text3: '#6F6F77',
    })
  })

  it('reads near-black in dark mode (bg and surface under OKLCH L 0.2)', () => {
    const toOklch = converter('oklch')
    expect(toOklch(neutrals.dark.bg)?.l).toBeLessThan(0.2)
    expect(toOklch(neutrals.dark.surface)?.l).toBeLessThan(0.2)
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

describe('semantic text on its own soft tint', () => {
  // Mirrors `color-mix(in oklab, var(--x) 12%, var(--surface))` from tokens.css.
  const softTint = (fg: string, surface: string) =>
    formatHex(interpolate([surface, fg], 'oklab')(0.12))

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

describe('presets and mascot', () => {
  it('lists the six presets with Lime first and makes Lime the default', () => {
    expect(accentPresets.map((p) => p.name)).toEqual([
      'Lime',
      'Sky',
      'Peach',
      'Lilac',
      'Rose',
      'Slate',
    ])
    expect(accentPresets[0]?.hex).toBe('#D8E88A')
    expect(defaultAccent.id).toBe('lime')
  })

  it('keeps every preset soft: a light color that takes ink text on its fill', () => {
    const toOklch = converter('oklch')
    for (const p of accentPresets) {
      expect(toOklch(p.hex)?.l, p.name).toBeGreaterThanOrEqual(0.8)
      expect(wcagContrast(p.hex, ink), p.name).toBeGreaterThanOrEqual(6)
    }
  })

  it('retires the old preset names and hexes, none of which collide with a new preset', () => {
    expect(retiredAccentPresets.map((p) => p.name)).toEqual([
      'Lake',
      'Moss',
      'Amber',
      'Coral',
      'Plum',
      'Slate',
    ])
    const live = new Set<string>(accentPresets.map((p) => p.hex))
    for (const p of retiredAccentPresets) expect(live.has(p.hex), p.name).toBe(false)
  })

  it('has the fixed mascot palette', () => {
    expect(mascot.fur).toBe('#8B5E3C')
    expect(Object.keys(mascot)).toEqual(['fur', 'furLight', 'tail', 'tooth', 'nose', 'blush'])
  })
})
