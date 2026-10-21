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
  '--secondary': '--surface-2',
  '--secondary-foreground': '--text',
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

  it('imports with relative paths (the @/ alias exists only for the shadcn CLI)', () => {
    const offenders = sources.filter((f) => /from\s+['"]@\//.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
