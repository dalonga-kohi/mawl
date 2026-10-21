import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { accentScaleKeys, accentTints, accentVarName, deriveAccent } from './accent.ts'
import { generateTokensCss } from './css.ts'
import { dur } from './motion.ts'
import { defaultAccent, mascot, neutrals, semantic } from './palette.ts'
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
const attrDark = blockAfter(css, ':root[data-theme="dark"]')
const themeBlock = blockAfter(css, '@theme inline')
const root = declarations(rootBlock)
const darkMedia = declarations(mediaDark)
const darkAttr = declarations(attrDark)

const publicAccentVars = [
  ['--accent', 'accent'],
  ['--accent-hover', 'accentHover'],
  ['--accent-press', 'accentPress'],
  ['--accent-fill', 'accentFill'],
  ['--on-accent', 'onAccent'],
  ['--accent-ink', 'accentInk'],
] as const

const kebab = (s: string) => s.replace(/([a-z])([A-Z0-9])/g, '$1-$2').toLowerCase()

describe('generateTokensCss', () => {
  it('is deterministic', () => {
    expect(generateTokensCss()).toBe(css)
  })

  it('defines every light neutral, semantic and mascot token in :root', () => {
    for (const [k, v] of Object.entries(neutrals.light)) expect(root.get(`--${kebab(k)}`)).toBe(v)
    for (const [k, v] of Object.entries(semantic.light)) expect(root.get(`--${kebab(k)}`)).toBe(v)
    for (const [k, v] of Object.entries(mascot)) expect(root.get(`--${kebab(k)}`)).toBe(v)
  })

  it('emits the default Lime light and dark scales and maps the public vars to the light one', () => {
    expect(defaultAccent.name).toBe('Lime')
    for (const theme of ['light', 'dark'] as const) {
      const lime = deriveAccent(defaultAccent.hex, theme)
      for (const key of accentScaleKeys) {
        expect(root.get(accentVarName(theme, key)), `${theme} ${key}`).toBe(lime[key])
      }
    }
    for (const [pub, key] of publicAccentVars) {
      expect(root.get(pub)).toBe(`var(${accentVarName('light', key)})`)
    }
  })

  it('expresses soft and softer as color-mix over the live accent, per theme', () => {
    for (const [theme, block] of [
      ['light', root],
      ['dark', darkAttr],
    ] as const) {
      const t = accentTints[theme]
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
    expect(root.get('--info')).toBe('var(--accent)')
  })

  it('draws the focus ring from accent-ink, so pastel accents still reach 3:1', () => {
    expect(root.get('--accent-ring')).toBe(
      `color-mix(in oklab, var(--accent-ink) ${accentTints.light.ring}%, transparent)`,
    )
    expect(darkAttr.get('--accent-ring')).toBe(
      `color-mix(in oklab, var(--accent-ink) ${accentTints.dark.ring}%, transparent)`,
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

  it('redefines the dark neutrals, semantic colors and accent in both dark blocks', () => {
    for (const block of [darkMedia, darkAttr]) {
      for (const [k, v] of Object.entries(neutrals.dark)) expect(block.get(`--${kebab(k)}`)).toBe(v)
      for (const [k, v] of Object.entries(semantic.dark)) expect(block.get(`--${kebab(k)}`)).toBe(v)
      for (const [pub, key] of publicAccentVars) {
        expect(block.get(pub)).toBe(`var(${accentVarName('dark', key)})`)
      }
      expect(block.get('--shadow-1')).toBe('0 0 0 1px var(--line)')
      expect(block.get('color-scheme')).toBe('dark')
    }
  })

  it('keeps the two dark blocks identical', () => {
    expect([...darkMedia.entries()]).toEqual([...darkAttr.entries()])
  })

  it('only redefines tokens that exist in :root', () => {
    for (const name of darkAttr.keys()) expect(root.has(name), name).toBe(true)
  })

  it('does not redefine fixed tokens in dark (mascot, type, space, motion)', () => {
    for (const name of darkAttr.keys()) {
      expect(name).not.toMatch(/^--(fur|tail|tooth|nose|blush|space|r|fs|lh|fw|ff|dur|ease)(-|$)/)
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
