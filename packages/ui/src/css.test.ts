import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateTokensCss, paletteColorDecls } from './css.ts'
import { dur } from './motion.ts'
import { type PaletteColors, paletteList, palettes, primaryStates, themeTints } from './palette.ts'
import { radii, spacing } from './space.ts'
import { typeScale } from './type.ts'

const css = generateTokensCss()

/** Returns the brace-balanced body that follows the first occurrence of `opener`. */
function blockAfter(source: string, opener: string): string {
  const start = source.indexOf(opener)
  if (start === -1) throw new Error(`block not found: ${opener}`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}' && --depth === 0) return source.slice(open + 1, i)
  }
  throw new Error(`unbalanced block: ${opener}`)
}

/** Declarations that sit directly in `block` (nested blocks are skipped). */
function declarations(block: string): Map<string, string> {
  const flat = block.replace(/\{[^{}]*\}/g, '')
  const out = new Map<string, string>()
  for (const m of flat.matchAll(/(--[\w-]+|color-scheme)\s*:\s*([^;]+);/g)) {
    out.set(m[1] as string, (m[2] as string).trim())
  }
  return out
}

const rootBlock = blockAfter(css, ':root {')
const mediaBlock = blockAfter(css, '@media (prefers-color-scheme: dark)')
const mediaDark = blockAfter(mediaBlock, ':root:not([data-theme="light"])')
const attrDark = blockAfter(css, ':root[data-theme="dark"] {')
const themeBlock = blockAfter(css, '@theme inline')
const root = declarations(rootBlock)
const darkMedia = declarations(mediaDark)
const darkAttr = declarations(attrDark)

/** The public variable each palette color drives. */
const expectedVars = (c: PaletteColors): Record<string, string> => {
  const { hover, press } = primaryStates(c)
  return {
    '--bg': c.bg,
    '--surface': c.surface,
    '--surface-2': c.surface2,
    '--line': c.line,
    '--text': c.text,
    '--text-2': c.text2,
    '--text-3': c.text3,
    '--accent': c.primary,
    '--accent-fill': c.primary,
    '--accent-hover': hover,
    '--accent-press': press,
    '--on-accent': c.onPrimary,
    '--accent-ink': c.accentInk,
    '--secondary': c.secondary,
    '--secondary-ink': c.secondaryInk,
    '--ok': c.ok,
    '--warn': c.warn,
    '--danger': c.danger,
    '--info': c.info,
  }
}

const expectColors = (block: Map<string, string>, c: PaletteColors, label: string) => {
  for (const [name, value] of Object.entries(expectedVars(c))) {
    expect(block.get(name), `${label} ${name}`).toBe(value)
  }
}

describe('generateTokensCss', () => {
  it('is deterministic', () => {
    expect(generateTokensCss()).toBe(css)
  })

  it('maps every palette color onto its public variable', () => {
    expect(Object.fromEntries(paletteColorDecls(palettes.nord.dark))).toEqual(
      expectedVars(palettes.nord.dark),
    )
  })

  it('makes Mawl the default: :root without a palette attribute is Mawl light', () => {
    expectColors(root, palettes.mawl.light, ':root')
    expect(root.get('--secondary-soft')).toBe(
      'color-mix(in oklab, var(--secondary) 12%, var(--surface))',
    )
  })

  it('makes Mawl dark the default dark, in both dark blocks', () => {
    expectColors(darkMedia, palettes.mawl.dark, 'media dark')
    expectColors(darkAttr, palettes.mawl.dark, 'data-theme dark')
  })

  it('emits a light, a system-dark and a forced-dark block per palette', () => {
    for (const p of paletteList) {
      const sel = `[data-palette="${p.id}"]`
      expectColors(declarations(blockAfter(css, `${sel} {`)), p.light, `${p.id} light`)
      expectColors(
        declarations(blockAfter(css, `${sel}[data-theme="dark"] {`)),
        p.dark,
        `${p.id} dark`,
      )
      const media = blockAfter(css, `@media (prefers-color-scheme: dark) {\n  ${sel}`)
      expectColors(
        declarations(blockAfter(media, `${sel}:not([data-theme="light"])`)),
        p.dark,
        `${p.id} system dark`,
      )
    }
  })

  it('scopes palettes to any element, so a preview card can wear another palette', () => {
    // :root-only selectors would make every preview inherit the app's palette.
    expect(css).not.toMatch(/:root\[data-palette/)
    // Every palette block, Mawl included, lands after the default blocks so it wins on ties.
    expect(css.indexOf('[data-palette="mawl"] {')).toBeGreaterThan(
      css.indexOf(':root[data-theme="dark"] {'),
    )
  })

  it('no longer emits the per-theme accent scale variables of the retired accent engine', () => {
    expect(css).not.toMatch(/--accent-(light|dark)-/)
  })

  it('no longer emits the beaver or lime mascot tokens', () => {
    for (const name of root.keys())
      expect(name).not.toMatch(/^--(fur|fur-light|tooth|nose|blush|tail)$/)
  })

  it('expresses soft and softer as color-mix over the live accent, per theme', () => {
    for (const [theme, block] of [
      ['light', root],
      ['dark', darkAttr],
    ] as const) {
      const t = themeTints[theme]
      expect(block.get('--accent-soft')).toBe(
        `color-mix(in oklab, var(--accent) ${t.soft}%, var(--surface))`,
      )
      expect(block.get('--accent-softer')).toBe(
        `color-mix(in oklab, var(--accent) ${t.softer}%, var(--surface))`,
      )
    }
    for (const name of ['ok', 'warn', 'danger']) {
      expect(root.get(`--${name}-soft`)).toContain(`var(--${name}) 12%`)
    }
  })

  it('draws the focus ring from accent-ink, per theme', () => {
    expect(root.get('--accent-ring')).toBe(
      `color-mix(in oklab, var(--accent-ink) ${themeTints.light.ring}%, transparent)`,
    )
    expect(darkAttr.get('--accent-ring')).toBe(
      `color-mix(in oklab, var(--accent-ink) ${themeTints.dark.ring}%, transparent)`,
    )
  })

  it('defines the round shape scale: pills for controls, card 24, panel 28, dialog 32', () => {
    expect(radii).toEqual({ xs: 8, sm: 12, md: 18, card: 24, panel: 28, dialog: 32, pill: 999 })
    for (const [k, v] of Object.entries(radii)) expect(root.get(`--r-${k}`)).toBe(`${v}px`)
  })

  it('defines space, type, font and motion tokens', () => {
    for (const s of spacing) expect(root.get(`--space-${s}`)).toBe(`${s}px`)
    expect(root.get('--fs-body')).toBe(`${typeScale.body.size}rem`)
    expect(root.get('--lh-body')).toBe(String(typeScale.body.lineHeight))
    expect(root.get('--fw-body')).toBe(String(typeScale.body.weight))
    expect(root.get('--ff-ui')).toContain('Figtree')
    expect(root.get('--dur-slow')).toBe(`${dur.slow}ms`)
    expect(root.get('--ease-out')).toBe('cubic-bezier(.2,.8,.2,1)')
    expect(root.get('--shadow-1')).toMatch(/^0 1px 2px rgb\(/)
  })

  it('declares the light color-scheme so a forced light theme wins over a dark OS', () => {
    expect(root.get('color-scheme')).toBe('light')
  })

  it('swaps shadows for a hairline and the color-scheme in both dark blocks', () => {
    for (const block of [darkMedia, darkAttr]) {
      expect(block.get('--shadow-1')).toBe('0 0 0 1px var(--line)')
      expect(block.get('color-scheme')).toBe('dark')
    }
  })

  it('keeps the two dark blocks identical', () => {
    expect([...darkMedia.entries()]).toEqual([...darkAttr.entries()])
  })

  it('only redefines tokens that exist in :root', () => {
    const redefined = [...css.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string)
    const themeOnly = new Set(declarations(themeBlock).keys())
    for (const name of redefined) {
      if (themeOnly.has(name)) continue
      expect(root.has(name), name).toBe(true)
    }
  })

  it('does not redefine fixed tokens per theme or palette (type, space, motion)', () => {
    for (const name of darkAttr.keys()) {
      expect(name).not.toMatch(/^--(space|r|fs|lh|fw|ff|dur|ease)(-|$)/)
    }
    for (const name of declarations(blockAfter(css, '[data-palette="dracula"] {')).keys()) {
      expect(name).not.toMatch(/^--(space|r|fs|lh|fw|ff|dur|ease|shadow)(-|$)/)
    }
  })

  it('maps colors, radii, fonts and easing for Tailwind in an @theme inline block', () => {
    const theme = declarations(themeBlock)
    expect(theme.get('--color-accent')).toBe('var(--accent)')
    expect(theme.get('--color-accent-fill')).toBe('var(--accent-fill)')
    expect(theme.get('--color-on-accent')).toBe('var(--on-accent)')
    expect(theme.get('--color-surface-2')).toBe('var(--surface-2)')
    expect(theme.get('--color-text-3')).toBe('var(--text-3)')
    expect(theme.get('--color-danger-soft')).toBe('var(--danger-soft)')
    expect(theme.get('--color-secondary')).toBe('var(--secondary)')
    expect(theme.get('--color-secondary-ink')).toBe('var(--secondary-ink)')
    expect(theme.get('--color-secondary-soft')).toBe('var(--secondary-soft)')
    expect(theme.get('--radius-md')).toBe('var(--r-md)')
    expect(theme.get('--radius-dialog')).toBe('var(--r-dialog)')
    expect(theme.get('--font-sans')).toBe('var(--ff-ui)')
    expect(theme.get('--font-display')).toBe('var(--ff-display)')
    expect(theme.get('--font-mono')).toBe('var(--ff-mono)')
    expect(theme.get('--ease-out')).toBe('cubic-bezier(.2,.8,.2,1)')
  })

  it('only references variables that are defined', () => {
    const defined = new Set(root.keys())
    for (const m of css.matchAll(/var\((--[\w-]+)\)/g))
      expect(defined.has(m[1] as string), m[1]).toBe(true)
  })

  it('matches the committed src/tokens.css (run `pnpm --filter @mawl/ui generate` after changes)', () => {
    const onDisk = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
    expect(onDisk).toBe(css)
  })
})
