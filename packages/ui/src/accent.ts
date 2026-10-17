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
 * Moves lightness from `startHex` toward black (`-1`) or white (`+1`) until the hex reaches `target`
 * contrast against `against`. Returns the closest-to-start hex that passes; contrast is checked on
 * the rounded hex so the guarantee holds for what is actually emitted.
 */
function shiftUntil(startHex: string, against: string, target: number, direction: -1 | 1): string {
  if (wcagContrast(startHex, against) >= target) return startHex
  const color = toOklch(startHex) as Oklch
  const passes = (l: number) => wcagContrast(hexAt(color, l), against) >= target
  let near = color.l // fails
  let far = direction === 1 ? 1 : 0 // passes (pure white or black against the surface)
  for (let i = 0; i < 24; i++) {
    const mid = (near + far) / 2
    if (passes(mid)) far = mid
    else near = mid
  }
  return hexAt(color, far)
}

/** Raises the base to at least `DARK_MIN_L` after hex rounding. */
function liftedBase(baseHex: string): string {
  const color = toOklch(baseHex) as Oklch
  if (color.l >= DARK_MIN_L) return baseHex
  let l = DARK_MIN_L
  let hex = hexAt(color, l)
  while ((toOklch(hex)?.l ?? 1) < DARK_MIN_L && l < 1) {
    l += 0.002
    hex = hexAt(color, l)
  }
  return hex
}

/** Hover and press are darker than the fill by 4% and 8% of OKLCH lightness. */
function fillStates(fillHex: string) {
  const fill = toOklch(fillHex) as Oklch
  return { hover: hexAt(fill, fill.l - HOVER_STEP), press: hexAt(fill, fill.l - PRESS_STEP) }
}

export function deriveAccent(hex: string, theme: ThemeName): AccentScale {
  const baseHex = formatHex(parseHex(hex))
  // Dark derives everything from the lifted base, so fill, states and ink never go darker than it.
  const eff = theme === 'dark' ? liftedBase(baseHex) : baseHex

  // White text unless the color is light. Ink is used only when it is >= 6:1 on the base and also
  // stays >= 4.5:1 on the darker hover and press fills; otherwise darken until white passes.
  let accentFill = eff
  let onAccent: string = WHITE
  if (wcagContrast(eff, WHITE) < TEXT_CONTRAST) {
    const { hover, press } = fillStates(eff)
    const inkHolds =
      wcagContrast(eff, ink) >= INK_ON_BASE_CONTRAST &&
      wcagContrast(hover, ink) >= TEXT_CONTRAST &&
      wcagContrast(press, ink) >= TEXT_CONTRAST
    if (inkHolds) onAccent = ink
    else accentFill = shiftUntil(eff, WHITE, TEXT_CONTRAST, -1)
  }

  const states = fillStates(accentFill)
  return {
    accent: eff,
    accentHover: states.hover,
    accentPress: states.press,
    accentFill,
    onAccent,
    accentInk: shiftUntil(eff, neutrals[theme].surface, TEXT_CONTRAST, theme === 'dark' ? 1 : -1),
  }
}

export interface AccentScales {
  light: AccentScale
  dark: AccentScale
}

/** Suffixes of the runtime variables, per scale entry: `--accent-{light|dark}-{suffix}`. */
const scaleSuffix = {
  accent: 'accent',
  accentHover: 'hover',
  accentPress: 'press',
  accentFill: 'fill',
  onAccent: 'on',
  accentInk: 'ink',
} as const satisfies Record<keyof AccentScale, string>

export const accentScaleKeys = Object.keys(scaleSuffix) as (keyof AccentScale)[]

export const accentVarName = (theme: ThemeName, key: keyof AccentScale) =>
  `--accent-${theme}-${scaleSuffix[key]}`

/**
 * Applies the accent to any style-like target (e.g. `document.documentElement.style`). Both the
 * light and dark scales are written; the generated CSS picks one per theme, so a theme flip needs
 * no JavaScript.
 */
export function applyAccent(hex: string, target: StyleTarget): AccentScales {
  const scales: AccentScales = {
    light: deriveAccent(hex, 'light'),
    dark: deriveAccent(hex, 'dark'),
  }
  for (const theme of ['light', 'dark'] as const) {
    for (const key of accentScaleKeys)
      target.setProperty(accentVarName(theme, key), scales[theme][key])
  }
  return scales
}
