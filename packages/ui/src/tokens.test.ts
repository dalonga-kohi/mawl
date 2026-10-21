import { describe, expect, it } from 'vitest'
import { dur, durSeconds, ease, reducedMotion, spring } from './motion.ts'
import { radii, shadows, spacing } from './space.ts'
import { fontFamilies, typeScale } from './type.ts'

describe('motion tokens', () => {
  it('defines the three DESIGN springs as Motion transitions', () => {
    expect(spring.gentle).toEqual({ type: 'spring', stiffness: 170, damping: 26 })
    expect(spring.snappy).toEqual({ type: 'spring', stiffness: 420, damping: 34 })
    expect(spring.bouncy).toEqual({ type: 'spring', stiffness: 260, damping: 14 })
  })

  it('exposes durations in ms and seconds', () => {
    expect(dur).toEqual({ fast: 120, base: 200, slow: 320 })
    expect(durSeconds).toEqual({ fast: 0.12, base: 0.2, slow: 0.32 })
  })

  it('exposes ease.out as an array and a CSS string', () => {
    expect(ease.out).toEqual([0.2, 0.8, 0.2, 1])
    expect(ease.outCss).toBe('cubic-bezier(.2,.8,.2,1)')
  })

  it('replaces springs with an instant fade under reduced motion', () => {
    expect(reducedMotion).toEqual({ duration: 0 })
  })
})

describe('space and shape tokens', () => {
  it('uses the 4px grid scale', () => {
    expect(spacing).toEqual([4, 8, 12, 16, 20, 24, 32, 40, 56])
  })

  it('has round radii by hierarchy plus a pill', () => {
    expect(radii).toEqual({ xs: 8, sm: 12, md: 18, card: 24, panel: 28, dialog: 32, pill: 999 })
  })

  it('has two warm shadows in light, and dark mode swaps them for a hairline', () => {
    expect(shadows.light.shadow1).toBe('0 1px 2px rgb(29 27 22 / .05)')
    expect(shadows.light.shadow2).toBe('0 12px 32px -12px rgb(29 27 22 / .16)')
    expect(shadows.dark.shadow1).toBe('0 0 0 1px var(--line)')
    expect(shadows.dark.shadow2).toBe('0 0 0 1px var(--line)')
  })
})

describe('type tokens', () => {
  it('has the six-step scale from DESIGN', () => {
    expect(Object.keys(typeScale)).toEqual([
      'display',
      'title',
      'heading',
      'body',
      'small',
      'micro',
    ])
    expect(typeScale.body).toEqual({ size: 0.9375, lineHeight: 1.55, weight: 450 })
    expect(typeScale.display).toEqual({ size: 2.25, lineHeight: 1.1, weight: 650 })
  })

  it('names the self-hosted variable faces first, then the static names, then fallbacks', () => {
    // @fontsource-variable registers "<Family> Variable"; the plain name covers a static install.
    expect(fontFamilies.ui.startsWith("'Figtree Variable', 'Figtree',")).toBe(true)
    expect(
      fontFamilies.display.startsWith("'Bricolage Grotesque Variable', 'Bricolage Grotesque',"),
    ).toBe(true)
    expect(fontFamilies.mono.startsWith("'JetBrains Mono Variable', 'JetBrains Mono',")).toBe(true)
    expect(fontFamilies.ui).toContain('system-ui')
  })
})
