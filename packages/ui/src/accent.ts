import { clampChroma, converter, formatHex, parse, wcagContrast } from 'culori'
import { ink, neutrals, type ThemeName } from './palette.ts'

/** Hex strings, all valid sRGB. soft/softer/ring are color-mix expressions in the generated CSS. */
export interface AccentScale {
  accent: string
  accentHover: string
  accentPress: string
  accentFill: string
  onAccent: string
  accentInk: string
}

export interface StyleTarget {
  setProperty(name: string, value: string): void
}

export class InvalidColorError extends Error {
  constructor(input: unknown) {
    super(`Invalid accent color ${JSON.stringify(input)}: expected a hex like #3D8BFD or #38F`)
    this.name = 'InvalidColorError'
  }
}

const toOklch = converter('oklch')
const WHITE = '#ffffff'
const TEXT_CONTRAST = 4.5
const INK_ON_BASE_CONTRAST = 6
const DARK_MIN_L = 0.68
const HOVER_STEP = 0.04
const PRESS_STEP = 0.08

type Oklch = NonNullable<ReturnType<typeof toOklch>>

function parseHex(input: string): Oklch {
  if (typeof input !== 'string' || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(input)) {
    throw new InvalidColorError(input)
  }
  const color = parse(input)
  const oklch = color && toOklch(color)
  if (!oklch) throw new InvalidColorError(input)
  return oklch
}

/** OKLCH lightness -> in-gamut hex, keeping hue and as much chroma as sRGB allows. */
function hexAt(color: Oklch, l: number): string {
  const clamped = clampChroma({ ...color, l: Math.min(1, Math.max(0, l)) }, 'oklch')
  return formatHex(clamped)
}

/**
 * Moves lightness from `color` toward black (`-1`) or white (`+1`) until `hex` reaches `target`
 * contrast against `against`. Returns the closest-to-original hex that passes; contrast is checked
 * on the rounded hex so the guarantee holds for what is actually emitted.
 */
function shiftUntil(color: Oklch, against: string, target: number, direction: -1 | 1): string {
  const passes = (l: number) => wcagContrast(hexAt(color, l), against) >= target
  if (passes(color.l)) return hexAt(color, color.l)
  const end = direction === 1 ? 1 : 0
  let near = color.l // fails
  let far = end // passes (pure white or black against the surface)
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2
    if (passes(mid)) far = mid
    else near = mid
  }
  return hexAt(color, far)
}

/** Raises the base to at least `DARK_MIN_L` after hex rounding. */
function liftedBase(color: Oklch): string {
  let l = Math.max(color.l, DARK_MIN_L)
  let hex = hexAt(color, l)
  while ((toOklch(hex)?.l ?? 1) < DARK_MIN_L && l < 1) {
    l += 0.002
    hex = hexAt(color, l)
  }
  return hex
}

export function deriveAccent(hex: string, theme: ThemeName): AccentScale {
  const base = parseHex(hex)
  const baseHex = formatHex(base)
  const surface = neutrals[theme].surface

  let accentFill = baseHex
  let onAccent = WHITE
  if (wcagContrast(baseHex, WHITE) < TEXT_CONTRAST) {
    if (wcagContrast(baseHex, ink) >= INK_ON_BASE_CONTRAST) onAccent = ink
    else accentFill = shiftUntil(base, WHITE, TEXT_CONTRAST, -1)
  }

  const fill = toOklch(accentFill) as Oklch
  return {
    accent: theme === 'dark' ? liftedBase(base) : baseHex,
    accentHover: hexAt(fill, fill.l - HOVER_STEP),
    accentPress: hexAt(fill, fill.l - PRESS_STEP),
    accentFill,
    onAccent,
    accentInk: shiftUntil(base, surface, TEXT_CONTRAST, theme === 'dark' ? 1 : -1),
  }
}

/** CSS custom property name for each scale entry that is set at runtime. */
export const accentVarNames = {
  accent: '--accent',
  accentHover: '--accent-hover',
  accentPress: '--accent-press',
  accentFill: '--accent-fill',
  onAccent: '--on-accent',
  accentInk: '--accent-ink',
} as const satisfies Record<keyof AccentScale, string>

/**
 * Applies the accent to any style-like target (e.g. `document.documentElement.style`).
 * Call again when the theme flips, because the dark scale differs from the light one.
 */
export function applyAccent(hex: string, theme: ThemeName, target: StyleTarget): AccentScale {
  const scale = deriveAccent(hex, theme)
  for (const key of Object.keys(accentVarNames) as (keyof AccentScale)[]) {
    target.setProperty(accentVarNames[key], scale[key])
  }
  return scale
}
