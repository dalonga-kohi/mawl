/**
 * Fixed colors from docs/DESIGN.md §3. The accent is user-selectable and derived at runtime
 * (see accent.ts), so only its presets live here. Components use the CSS variables, never these.
 */

export type ThemeName = 'light' | 'dark'

export const neutrals = {
  /** "Mist" */
  light: {
    bg: '#F5F7FA',
    surface: '#FFFFFF',
    surface2: '#EEF2F6',
    line: '#E1E6EC',
    text: '#17202B',
    text2: '#5A6675',
    text3: '#8A95A3',
  },
  /** "Night river" */
  dark: {
    bg: '#0F141A',
    surface: '#161C24',
    surface2: '#1D2530',
    line: '#26303C',
    text: '#E8EDF3',
    text2: '#A3AEBB',
    text3: '#6E7A88',
  },
} as const

/** Ink used as text on light accent fills (same value as neutrals.light.text). */
export const ink = '#17202B'

/**
 * Status colors, never accent-driven. Each theme has its own value so the color reaches 4.5:1 when
 * used as text on that theme's surface (a single value cannot do that on both white and Night river).
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

export const accentPresets = [
  { id: 'lake', name: 'Lake', hex: '#3D8BFD' },
  { id: 'moss', name: 'Moss', hex: '#3FA36B' },
  { id: 'amber', name: 'Amber', hex: '#E09A1E' },
  { id: 'coral', name: 'Coral', hex: '#EF6F5E' },
  { id: 'plum', name: 'Plum', hex: '#8E6BE8' },
  { id: 'slate', name: 'Slate', hex: '#5B6B82' },
] as const

export type AccentPresetId = (typeof accentPresets)[number]['id']

export const defaultAccent = accentPresets[0]
