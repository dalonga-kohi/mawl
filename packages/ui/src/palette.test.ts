import { converter, formatHex, interpolate, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import * as palette from './palette.ts'
import {
  DEFAULT_PALETTE_ID,
  isPaletteId,
  PALETTE_IDS,
  type PaletteColors,
  paletteList,
  palettes,
  primaryStates,
  type ThemeName,
  themeTints,
} from './palette.ts'

const themes: ThemeName[] = ['light', 'dark']
const HEX = /^#[0-9A-F]{6}$/

const colorKeys: (keyof PaletteColors)[] = [
  'bg',
  'surface',
  'surface2',
  'line',
  'text',
  'text2',
  'text3',
  'primary',
  'onPrimary',
  'accentInk',
  'secondary',
  'secondaryInk',
  'ok',
  'warn',
  'danger',
  'info',
]

/** Mirrors `color-mix(in oklab, fg pct%, over)` from tokens.css. */
const mix = (fg: string, over: string, pct: number) =>
  formatHex(interpolate([over, fg], 'oklab')(pct / 100))

describe('palette registry', () => {
  it('lists the seven named palettes, Mawl first and default', () => {
    expect(PALETTE_IDS).toEqual([
      'mawl',
      'dracula',
      'catppuccin',
      'gruvbox',
      'claude',
      'rose-pine',
      'nord',
    ])
    expect(paletteList.map((p) => p.name)).toEqual([
      'Mawl',
      'Dracula',
      'Catppuccin',
      'Gruvbox',
      'Claude',
      'Rosé Pine',
      'Nord',
    ])
    expect(DEFAULT_PALETTE_ID).toBe('mawl')
    for (const p of paletteList) expect(palettes[p.id]).toBe(p)
  })

  it('gives every palette a light and a dark set with every token as an upper-case hex', () => {
    for (const p of paletteList) {
      for (const theme of themes) {
        expect(Object.keys(p[theme]).sort(), `${p.id} ${theme}`).toEqual([...colorKeys].sort())
        for (const key of colorKeys) expect(p[theme][key], `${p.id} ${theme} ${key}`).toMatch(HEX)
      }
    }
  })

  it('recognises palette ids and nothing else', () => {
    for (const id of PALETTE_IDS) expect(isPaletteId(id)).toBe(true)
    for (const bad of ['', 'Mawl', 'solarized', '#7950E8', null, undefined, 7, {}]) {
      expect(isPaletteId(bad), String(bad)).toBe(false)
    }
  })

  it('keeps the shipped Mawl values', () => {
    expect(palettes.mawl.light).toMatchObject({
      bg: '#F5F7FC',
      surface: '#FFFFFF',
      surface2: '#EBEFF7',
      text: '#1B2432',
      text2: '#58677D',
      primary: '#7950E8',
      onPrimary: '#FFFFFF',
      accentInk: '#5E32C5',
      secondary: '#087F86',
      secondaryInk: '#06767D',
    })
    expect(palettes.mawl.dark).toMatchObject({
      bg: '#0B1019',
      surface: '#1B2433',
      surface2: '#121926',
      text: '#F2F5FC',
      text2: '#A7B2C4',
      primary: '#7950E8',
      onPrimary: '#FFFFFF',
      accentInk: '#BDA4ED',
      secondary: '#80DACE',
      secondaryInk: '#80DACE',
    })
  })

  it('reads deep navy in Mawl dark: bg under OKLCH L 0.2 with a blue hue', () => {
    const bg = converter('oklch')(palettes.mawl.dark.bg)
    expect(bg?.l).toBeLessThan(0.2)
    expect(bg?.h).toBeGreaterThan(230)
    expect(bg?.h).toBeLessThan(280)
  })

  it('reads light as light and dark as dark for every palette', () => {
    for (const p of paletteList) {
      expect(wcagContrast(p.light.bg, '#000000'), p.id).toBeGreaterThan(14)
      expect(wcagContrast(p.dark.bg, '#FFFFFF'), p.id).toBeGreaterThan(12)
    }
  })

  it('no longer carries the beaver or lime mascot colors, nor the accent presets', () => {
    expect('mascot' in palette).toBe(false)
    expect('accentPresets' in palette).toBe(false)
  })
})

/** Every palette x theme, so a failure names the exact pair. */
const cases = paletteList.flatMap((p) => themes.map((theme) => [p.id, theme, p[theme]] as const))

describe.each(cases)('%s %s contrast', (_id, theme, c) => {
  const grounds = { bg: c.bg, surface: c.surface, surface2: c.surface2 }

  it('text, text-2 and text-3 reach 4.5:1 on bg, surface and surface-2', () => {
    for (const [g, ground] of Object.entries(grounds)) {
      for (const t of ['text', 'text2', 'text3'] as const) {
        expect(wcagContrast(c[t], ground), `${t} on ${g}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('steps text, text-2 and text-3 down in strength', () => {
    expect(wcagContrast(c.text, c.surface)).toBeGreaterThan(wcagContrast(c.text2, c.surface))
    expect(wcagContrast(c.text2, c.surface)).toBeGreaterThanOrEqual(
      wcagContrast(c.text3, c.surface),
    )
  })

  it('accent ink and secondary ink reach 4.5:1 on bg, surface and surface-2', () => {
    for (const [g, ground] of Object.entries(grounds)) {
      expect(wcagContrast(c.accentInk, ground), `accent ink on ${g}`).toBeGreaterThanOrEqual(4.5)
      expect(wcagContrast(c.secondaryInk, ground), `secondary ink on ${g}`).toBeGreaterThanOrEqual(
        4.5,
      )
    }
  })

  it('accent ink and secondary ink stay readable on their own soft tints', () => {
    const t = themeTints[theme]
    const accentSoft = mix(c.primary, c.surface, t.soft)
    expect(
      wcagContrast(c.accentInk, accentSoft),
      'accent ink on accent-soft',
    ).toBeGreaterThanOrEqual(4.5)
    const secondarySoft = mix(c.secondary, c.surface, 12)
    expect(wcagContrast(c.secondaryInk, secondarySoft)).toBeGreaterThanOrEqual(4.5)
  })

  it('on-primary reaches 4.5:1 on the primary fill and on its hover and press states', () => {
    const { hover, press } = primaryStates(c)
    for (const [name, fill] of [
      ['fill', c.primary],
      ['hover', hover],
      ['press', press],
    ] as const) {
      expect(wcagContrast(c.onPrimary, fill), name).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('primary and secondary fills reach 3:1 as UI on bg and surface', () => {
    for (const g of ['bg', 'surface'] as const) {
      expect(wcagContrast(c.primary, grounds[g]), `primary on ${g}`).toBeGreaterThanOrEqual(3)
      expect(wcagContrast(c.secondary, grounds[g]), `secondary on ${g}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('the focus ring reaches 3:1 on bg, surface and surface-2', () => {
    for (const [g, ground] of Object.entries(grounds)) {
      const ring = mix(c.accentInk, ground, themeTints[theme].ring)
      expect(wcagContrast(ring, ground), `ring on ${g}`).toBeGreaterThanOrEqual(3)
    }
  })

  it('hairlines are visible on every surface without shouting', () => {
    for (const [g, ground] of Object.entries(grounds)) {
      const ratio = wcagContrast(c.line, ground)
      expect(ratio, `line on ${g}`).toBeGreaterThanOrEqual(1.1)
      expect(ratio, `line on ${g}`).toBeLessThan(3)
    }
  })

  it('ok, warn, danger and info reach 4.5:1 as text on bg, surface and their soft tint', () => {
    for (const name of ['ok', 'warn', 'danger', 'info'] as const) {
      const tint = mix(c[name], c.surface, 12)
      for (const [g, ground] of Object.entries({ bg: c.bg, surface: c.surface, tint })) {
        expect(wcagContrast(c[name], ground), `${name} on ${g}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
