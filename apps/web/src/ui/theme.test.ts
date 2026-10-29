import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateTokensCss, radii } from '@mawl/ui'
import { describe, expect, it } from 'vitest'

// jsdom gives import.meta.url an http scheme, so resolve from the file's directory instead.
const srcDir = join(import.meta.dirname, '..')
const styles = readFileSync(join(srcDir, 'styles.css'), 'utf8')
const tokens = generateTokensCss()

/** Declarations in the first `selector { … }` block of `css` (flat blocks only). */
function block(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start === -1) throw new Error(`block not found: ${selector}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out = new Map<string, string>()
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
    out.set(m[1] as string, m[2] as string)
  return out
}

const tokenNames = new Set([...tokens.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1] as string))
const shadcnRoot = block(styles, ':root')
const theme = block(styles, '@theme inline')

/** shadcn's semantic variables, each pointed at the @mawl/ui token that plays the same role. */
const shadcnVars = {
  '--background': '--bg',
  '--foreground': '--text',
  '--card': '--surface',
  '--card-foreground': '--text',
  '--popover': '--surface',
  '--popover-foreground': '--text',
  '--primary': '--accent-fill',
  '--primary-foreground': '--on-accent',
  '--muted': '--surface-2',
  '--muted-foreground': '--text-2',
  '--destructive': '--danger',
  '--border': '--line',
  '--input': '--line',
  '--ring': '--accent-ring',
  '--radius': '--r-card',
} as const

describe('shadcn variables on Mawl tokens', () => {
  it('maps every shadcn variable onto an existing @mawl/ui token', () => {
    for (const [name, token] of Object.entries(shadcnVars)) {
      expect(shadcnRoot.get(name), name).toBe(`var(${token})`)
      expect(tokenNames.has(token), token).toBe(true)
    }
  })

  it('exposes the shadcn colors to Tailwind through @theme inline', () => {
    for (const name of Object.keys(shadcnVars)) {
      if (name === '--radius') continue
      expect(theme.get(`--color-${name.slice(2)}`), name).toBe(`var(${name})`)
    }
  })

  it('leaves --secondary to the Mawl teal: no shadcn alias overrides it', () => {
    expect(shadcnRoot.has('--secondary')).toBe(false)
    expect(shadcnRoot.has('--secondary-foreground')).toBe(false)
    expect(tokenNames.has('--secondary')).toBe(true)
    for (const name of ['secondary', 'secondary-ink', 'secondary-soft']) {
      expect(theme.get(`--color-${name}`), name).toBe(`var(--${name})`)
    }
  })

  it('exposes every @mawl/ui radius, and only those, to Tailwind', () => {
    const radiusKeys = [...theme.keys()].filter((k) => k.startsWith('--radius-'))
    expect(styles).toContain('--radius-*: initial;')
    expect(radiusKeys.sort()).toEqual(
      Object.keys(radii)
        .map((k) => `--radius-${k}`)
        .sort(),
    )
    for (const k of Object.keys(radii)) expect(theme.get(`--radius-${k}`)).toBe(`var(--r-${k})`)
  })
})

describe('token discipline', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
    )
  const sources = files(srcDir).filter((f) => /\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f))

  it('uses no raw hex colors in the ui primitives or the stylesheet', () => {
    const offenders = sources
      .filter((f) => f.includes(`${join('src', 'ui')}`) || f.endsWith('styles.css'))
      .filter((f) => /#[0-9a-f]{3,8}\b/i.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('names every @keyframes once across the stylesheets, so no animation silently overrides another', () => {
    const names = sources
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]),
      )
    const dupes = names.filter((n, i) => names.indexOf(n) !== i)
    expect(dupes).toEqual([])
  })

  it('shapes controls as rounded rectangles: no pill radius anywhere (round things use rounded-full)', () => {
    const offenders = sources.filter((f) =>
      /rounded-pill|--r-pill|radius-pill/.test(readFileSync(f, 'utf8')),
    )
    expect(offenders).toEqual([])
  })

  it('exposes the hover and selected fills to Tailwind', () => {
    expect(theme.get('--color-hover')).toBe('var(--hover)')
    expect(theme.get('--color-selected')).toBe('var(--selected)')
    expect(tokenNames.has('--hover')).toBe(true)
    expect(tokenNames.has('--selected')).toBe(true)
  })

  it('imports with relative paths (the @/ alias exists only for the shadcn CLI)', () => {
    const offenders = sources.filter((f) => /from\s+['"]@\//.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})

describe('palette and theme swaps', () => {
  const start = styles.indexOf('@media (prefers-reduced-motion: no-preference)')
  const rule = styles.slice(start, styles.indexOf('\n}\n', start))

  it('cross-fades colors only, only during a swap and never under reduced motion', () => {
    expect(start).toBeGreaterThan(-1)
    expect(rule).toContain(':root.color-swap:not(.reduce-motion) *')
    expect(rule).toMatch(/transition-property:[^;]*background-color[^;]*color/)
    expect(rule).not.toMatch(/transition-property:[^;]*(transform|translate|scale|width|height)/)
    expect(rule).toContain('transition-duration: var(--dur-base)')
  })

  it('stays outside any @layer, so it wins over the layered Tailwind utilities', () => {
    const before = styles.slice(0, start)
    const opened = (before.match(/@layer [\w-]+\s*\{/g) ?? []).length
    expect(opened).toBeGreaterThan(0)
    // Every layer block opened before the rule has closed: count braces from the last @layer.
    const lastLayer = before.lastIndexOf('@layer')
    const tail = before.slice(lastLayer)
    expect((tail.match(/\{/g) ?? []).length).toBe((tail.match(/\}/g) ?? []).length)
  })
})

describe('scrollbars', () => {
  it('draws slim round overlay thumbs that appear on hover, with the standard path only as a fallback', () => {
    expect(styles).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*border-radius:\s*999px/)
    expect(styles).toMatch(/::-webkit-scrollbar-thumb\s*\{[^}]*background-clip:\s*padding-box/)
    expect(styles).toMatch(/\*:hover,\s*\*:focus-within\s*\{\s*--thumb:/)
    // Chromium ignores the pseudo-elements once scrollbar-color is set, so it stays in @supports not.
    const fallback = styles.indexOf('@supports not selector(::-webkit-scrollbar)')
    expect(fallback).toBeGreaterThan(-1)
    expect(styles.indexOf('scrollbar-color')).toBeGreaterThan(fallback)
    expect(styles.slice(0, fallback)).not.toMatch(/scrollbar-color/)
  })
})
