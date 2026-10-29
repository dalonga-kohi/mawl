import { converter, formatHex, interpolate, wcagContrast } from 'culori'
import { describe, expect, it } from 'vitest'
import { accentTints, applyAccent, deriveAccent, InvalidColorError } from './accent.ts'
import { accentPresets, ink, mawlAccent, neutrals, type ThemeName } from './palette.ts'

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

const randomHex = (rand: () => number) =>
  `#${Math.floor(rand() * 0x1000000)
    .toString(16)
    .padStart(6, '0')}`

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
  it('darkens a mid blue (the retired Lake) into a fill near #2B6FE6 that keeps the hue and takes white text', () => {
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

  it('keeps a light base like amber and switches the text to ink', () => {
    const s = deriveAccent('#E09A1E', 'light')
    expect(s.accentFill.toLowerCase()).toBe('#e09a1e')
    expect(s.onAccent).toBe(ink)
  })

  it('keeps Lime as the fill in both themes, with ink text and a darker olive accent-ink', () => {
    for (const theme of themes) {
      const s = deriveAccent('#D8E88A', theme)
      expect(s.accentFill.toLowerCase(), theme).toBe('#d8e88a')
      expect(s.onAccent, theme).toBe(ink)
    }
    const light = deriveAccent('#D8E88A', 'light')
    const base = toOklch('#D8E88A')
    const lightInk = toOklch(light.accentInk)
    expect(lightInk?.l).toBeLessThan(base?.l ?? 0)
    expect(Math.abs((lightInk?.h ?? 0) - (base?.h ?? 0))).toBeLessThanOrEqual(12)
  })

  it('pins the Mawl primary: the same fill with white text in both themes and the hand-picked ink', () => {
    for (const theme of themes) {
      for (const input of [mawlAccent.hex, mawlAccent.hex.toLowerCase()]) {
        const s = deriveAccent(input, theme)
        expect(s.accentFill.toUpperCase(), theme).toBe(mawlAccent.hex)
        expect(s.onAccent.toLowerCase(), theme).toBe('#ffffff')
        expect(s.accentInk.toUpperCase(), theme).toBe(mawlAccent.ink[theme])
        expect(toOklch(s.accentHover)?.l).toBeLessThan(toOklch(s.accentFill)?.l ?? 0)
      }
    }
    expect(deriveAccent(mawlAccent.hex, 'light').accent.toUpperCase()).toBe(mawlAccent.hex)
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

describe('onAccent on every fill state', () => {
  const failures = (hexes: string[]) => {
    const out: string[] = []
    for (const hex of hexes) {
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        for (const key of ['accentFill', 'accentHover', 'accentPress'] as const) {
          const c = wcagContrast(s.onAccent, s[key])
          if (c < 4.5) out.push(`${hex} ${theme} ${key} ${c.toFixed(2)}`)
        }
      }
    }
    return out
  }

  it('reaches 4.5:1 on fill, hover and press for presets and extremes', () => {
    expect(
      failures([...accentPresets.map((p) => p.hex), '#000000', '#FFFFFF', '#FFFF00', '#0000FF']),
    ).toEqual([])
  })

  it('reaches 4.5:1 on fill, hover and press for 300 pseudo-random colors', () => {
    const rand = prng(7)
    const hexes = Array.from({ length: 300 }, () => randomHex(rand))
    expect(failures(hexes)).toEqual([])
  })

  it('regressions: colors whose press state used to drop ink below 4.5:1', () => {
    expect(failures(['#c89446', '#19afa5'])).toEqual([])
  })

  it('pins Coral: ink on the base is under 6:1, so the fill darkens and keeps white text', () => {
    for (const theme of themes) {
      const s = deriveAccent('#EF6F5E', theme)
      expect(s.onAccent.toLowerCase()).toBe('#ffffff')
      expect(s.accentFill.toLowerCase()).not.toBe('#ef6f5e')
      expect(wcagContrast('#ffffff', s.accentFill)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('dark derivation starts from the lifted base', () => {
  it('keeps accent-ink at OKLCH L >= 0.68 in dark', () => {
    const rand = prng(11)
    const hexes = [
      ...accentPresets.map((p) => p.hex),
      '#000000',
      '#0A0F3C',
      ...Array.from({ length: 100 }, () => randomHex(rand)),
    ]
    for (const hex of hexes) {
      expect(toOklch(deriveAccent(hex, 'dark').accentInk)?.l, hex).toBeGreaterThanOrEqual(0.68)
    }
  })
})

describe('accent tints and the focus ring', () => {
  // Mirrors `color-mix(in oklab, <fg> <pct>%, <bg>)` from tokens.css.
  const mix = (fg: string, bg: string, pct: number) =>
    formatHex(interpolate([bg, fg], 'oklab')(pct / 100))
  const rand = prng(42)
  const hexes = [
    ...accentPresets.map((p) => p.hex),
    '#000000',
    '#FFFFFF',
    '#FFFF00',
    '#0000FF',
    '#3D8BFD',
    ...Array.from({ length: 200 }, () => randomHex(rand)),
  ]

  it('keeps accent-ink at 4.5:1 on bg, surface, surface-2 and the soft tint', () => {
    const failures: string[] = []
    for (const hex of hexes) {
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        const n = neutrals[theme]
        const soft = mix(s.accent, n.surface, accentTints[theme].soft)
        for (const [name, bg] of [
          ['bg', n.bg],
          ['surface', n.surface],
          ['surface-2', n.surface2],
          ['soft', soft],
        ] as const) {
          const c = wcagContrast(s.accentInk, bg)
          if (c < 4.5) failures.push(`${hex} ${theme} ink/${name} ${c.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('keeps body text at 4.5:1 on the soft tint (user bubbles, selection)', () => {
    const failures: string[] = []
    for (const hex of hexes) {
      for (const theme of themes) {
        const n = neutrals[theme]
        const soft = mix(deriveAccent(hex, theme).accent, n.surface, accentTints[theme].soft)
        const c = wcagContrast(n.text, soft)
        if (c < 4.5) failures.push(`${hex} ${theme} ${c.toFixed(2)}`)
      }
    }
    expect(failures).toEqual([])
  })

  it('makes the soft tint of every preset visibly distinct from the surface', () => {
    const toLab = converter('oklab')
    for (const p of accentPresets) {
      for (const theme of themes) {
        const n = neutrals[theme]
        const soft = mix(deriveAccent(p.hex, theme).accent, n.surface, accentTints[theme].soft)
        const a = toLab(soft)
        const b = toLab(n.surface)
        const d = Math.hypot(
          (a?.l ?? 0) - (b?.l ?? 0),
          (a?.a ?? 0) - (b?.a ?? 0),
          (a?.b ?? 0) - (b?.b ?? 0),
        )
        expect(d, `${p.name} ${theme}`).toBeGreaterThanOrEqual(0.03)
      }
    }
  })

  it('draws the focus ring at 3:1 against bg and surface (WCAG non-text contrast)', () => {
    const failures: string[] = []
    for (const hex of hexes) {
      for (const theme of themes) {
        const s = deriveAccent(hex, theme)
        const n = neutrals[theme]
        for (const bg of [n.bg, n.surface]) {
          const ring = mix(s.accentInk, bg, accentTints[theme].ring)
          const c = wcagContrast(ring, bg)
          if (c < 3) failures.push(`${hex} ${theme} ${bg} ${c.toFixed(2)}`)
        }
      }
    }
    expect(failures).toEqual([])
  })
})

describe('applyAccent', () => {
  const names = ['accent', 'hover', 'press', 'fill', 'on', 'ink']
  const capture = () => {
    const calls = new Map<string, string>()
    return { calls, target: { setProperty: (n: string, v: string) => void calls.set(n, v) } }
  }

  it('sets both the light and dark scales, and nothing else', () => {
    const { calls, target } = capture()
    const { light, dark } = applyAccent('#3D8BFD', target)
    expect([...calls.keys()].sort()).toEqual(
      ['light', 'dark'].flatMap((t) => names.map((n) => `--accent-${t}-${n}`)).sort(),
    )
    expect(light).toEqual(deriveAccent('#3D8BFD', 'light'))
    expect(dark).toEqual(deriveAccent('#3D8BFD', 'dark'))
    expect(calls.get('--accent-light-fill')).toBe(light.accentFill)
    expect(calls.get('--accent-dark-on')).toBe(dark.onAccent)
    expect(calls.get('--accent-dark-ink')).toBe(dark.accentInk)
  })

  it('throws before touching the target for an invalid color', () => {
    const { calls, target } = capture()
    expect(() => applyAccent('nope', target)).toThrow(InvalidColorError)
    expect(calls.size).toBe(0)
  })
})
