import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deriveAccent } from './accent.ts'
import { generateTokensCss } from './css.ts'
import { dur } from './motion.ts'
import { accentPresets, mascot, neutrals, semantic } from './palette.ts'
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

  it('derives the default Lake accent vars in :root', () => {
    const lake = deriveAccent(accentPresets[0].hex, 'light')
    expect(root.get('--accent')).toBe(lake.accent)
    expect(root.get('--accent-fill')).toBe(lake.accentFill)
    expect(root.get('--on-accent')).toBe(lake.onAccent)
    expect(root.get('--accent-ink')).toBe(lake.accentInk)
    expect(root.get('--accent-hover')).toBe(lake.accentHover)
    expect(root.get('--accent-press')).toBe(lake.accentPress)
  })

  it('expresses soft, softer and ring as color-mix over the live accent', () => {
    expect(root.get('--accent-soft')).toMatch(
      /^color-mix\(in oklab, var\(--accent\) 12%, var\(--surface\)\)$/,
    )
    expect(root.get('--accent-softer')).toMatch(/var\(--accent\) 6%/)
    expect(root.get('--accent-ring')).toMatch(/var\(--accent\) 40%, transparent/)
    for (const name of ['ok', 'warn', 'danger']) {
      expect(root.get(`--${name}-soft`)).toContain(`var(--${name}) 12%`)
    }
    expect(root.get('--info')).toBe('var(--accent)')
  })

  it('defines space, radii, type, font and motion tokens', () => {
    for (const s of spacing) expect(root.get(`--space-${s}`)).toBe(`${s}px`)
    expect(root.get('--r-md')).toBe(`${radii.md}px`)
    expect(root.get('--r-pill')).toBe('999px')
    expect(root.get('--fs-body')).toBe(`${typeScale.body.size}rem`)
    expect(root.get('--lh-body')).toBe(String(typeScale.body.lineHeight))
    expect(root.get('--fw-body')).toBe(String(typeScale.body.weight))
    expect(root.get('--ff-ui')).toContain('Figtree')
    expect(root.get('--dur-slow')).toBe(`${dur.slow}ms`)
    expect(root.get('--ease-out')).toBe('cubic-bezier(.2,.8,.2,1)')
    expect(root.get('--shadow-1')).toContain('rgb(16 24 40 / .05)')
  })

  it('declares the light color-scheme so a forced light theme wins over a dark OS', () => {
    expect(root.get('color-scheme')).toBe('light')
  })

  it('redefines the dark neutrals, semantic colors and accent in both dark blocks', () => {
    for (const block of [darkMedia, darkAttr]) {
      for (const [k, v] of Object.entries(neutrals.dark)) expect(block.get(`--${kebab(k)}`)).toBe(v)
      for (const [k, v] of Object.entries(semantic.dark)) expect(block.get(`--${kebab(k)}`)).toBe(v)
      const lakeDark = deriveAccent(accentPresets[0].hex, 'dark')
      expect(block.get('--accent')).toBe(lakeDark.accent)
      expect(block.get('--accent-ink')).toBe(lakeDark.accentInk)
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

  it('matches the committed src/tokens.css (run `pnpm --filter @faire/ui generate` after changes)', () => {
    const onDisk = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8')
    expect(onDisk).toBe(css)
  })
})
