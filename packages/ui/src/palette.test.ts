import { formatHex, interpolate, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import { accentPresets, mascot, neutrals, semantic, type ThemeName } from './palette.ts'

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

  it('uses the DESIGN.md Mist and Night river values', () => {
    expect(neutrals.light.bg).toBe('#F5F7FA')
    expect(neutrals.light.surface).toBe('#FFFFFF')
    expect(neutrals.dark.bg).toBe('#0F141A')
    expect(neutrals.dark.surface).toBe('#161C24')
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
  it('lists the six presets with Lake first', () => {
    expect(accentPresets.map((p) => p.name)).toEqual([
      'Lake',
      'Moss',
      'Amber',
      'Coral',
      'Plum',
      'Slate',
    ])
    expect(accentPresets[0]?.hex).toBe('#3D8BFD')
  })

  it('has the fixed mascot palette', () => {
    expect(mascot.fur).toBe('#8B5E3C')
    expect(Object.keys(mascot)).toEqual(['fur', 'furLight', 'tail', 'tooth', 'nose', 'blush'])
  })
})
