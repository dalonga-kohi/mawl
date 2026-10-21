/**
 * Fixed colors from docs/DESIGN.md §3 and docs/UI-REDESIGN.md §3. The accent is user-selectable and
 * derived at runtime (see accent.ts), so only its presets live here. Components use the CSS
 * variables, never these.
 */

export type ThemeName = 'light' | 'dark'

export const neutrals = {
  /** "Cream": warm, airy paper. */
  light: {
    bg: '#FAF8F4',
    surface: '#FFFFFF',
    surface2: '#F2EFE8',
    line: '#E7E3DA',
    text: '#1D1B16',
    text2: '#5E5A50',
    text3: '#8C877B',
  },
  /** "Ink": near-black and neutral, with hairline borders instead of shadows. */
  dark: {
    bg: '#0B0B0D',
    surface: '#131315',
    surface2: '#1B1B1E',
    line: '#26262A',
    text: '#ECECEE',
    text2: '#A6A6AD',
    text3: '#6F6F77',
  },
} as const

/** Ink used as text on light accent fills (same value as neutrals.light.text). */
export const ink = '#1D1B16'

/**
 * Status colors, never accent-driven. Each theme has its own value so the color reaches 4.5:1 when
 * used as text on that theme's surface (a single value cannot do that on both white and Ink).
 */
export const semantic = {
  light: { ok: '#007A4A', warn: '#985D00', danger: '#C33632' },
  dark: { ok: '#32A16A', warn: '#D98A14', danger: '#EF6056' },
} as const

export const mascot = {
  fur: '#8B5E3C',
  furLight: '#B07D52',
  tail: '#5B3D28',
  tooth: '#FFF7E6',
  nose: '#2A1E16',
  blush: '#F2A38F',
} as const

/**
 * Soft, light accents of about the same lightness as Lime (Mawl's own color). Every one takes ink
 * text on its fill; the engine derives a darker `--accent-ink` for small text on surfaces.
 */
export const accentPresets = [
  { id: 'lime', name: 'Lime', hex: '#D8E88A' },
  { id: 'sky', name: 'Sky', hex: '#A9D3F5' },
  { id: 'peach', name: 'Peach', hex: '#F7C4A3' },
  { id: 'lilac', name: 'Lilac', hex: '#CBB9F4' },
  { id: 'rose', name: 'Rose', hex: '#F4B6C4' },
  { id: 'slate', name: 'Slate', hex: '#B9C3CF' },
] as const

export type AccentPresetId = (typeof accentPresets)[number]['id']

export const defaultAccent = accentPresets[0]

/**
 * The presets before the 2026-10 redesign. Saved preferences that still hold one of these fall
 * back to the default accent, so a retired preset never lingers as an unnamed custom color.
 */
export const retiredAccentPresets = [
  { id: 'lake', name: 'Lake', hex: '#3D8BFD' },
  { id: 'moss', name: 'Moss', hex: '#3FA36B' },
  { id: 'amber', name: 'Amber', hex: '#E09A1E' },
  { id: 'coral', name: 'Coral', hex: '#EF6F5E' },
  { id: 'plum', name: 'Plum', hex: '#8E6BE8' },
  { id: 'slate', name: 'Slate', hex: '#5B6B82' },
] as const
