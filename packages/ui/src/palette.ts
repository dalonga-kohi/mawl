/**
 * Fixed colors from docs/DESIGN.md §3: the Mawl palette (2026-10 orb redesign). The accent is
 * user-selectable and derived at runtime (see accent.ts), so only its presets live here. Components
 * use the CSS variables, never these. The orb mascot's colourways live with the mascot
 * (apps/web/src/mascot/ways.ts), not here.
 */

export type ThemeName = 'light' | 'dark'

/**
 * `bg` is the app background, `surface` the card, `surface2` the sidebar (also used for hover and
 * selected fills, chips and wells).
 */
export const neutrals = {
  /** Mawl light: cool paper with white cards. */
  light: {
    bg: '#F5F7FC',
    surface: '#FFFFFF',
    surface2: '#EBEFF7',
    line: '#DCE2EE',
    text: '#1B2432',
    text2: '#58677D',
    text3: '#6F7C91',
  },
  /** Mawl dark: deep navy, with hairline borders instead of shadows. */
  dark: {
    bg: '#0B1019',
    surface: '#1B2433',
    surface2: '#121926',
    line: '#273246',
    text: '#F2F5FC',
    text2: '#A7B2C4',
    text3: '#6F7C91',
  },
} as const

/** Ink used as text on light accent fills (same value as neutrals.light.text). */
export const ink = '#1B2432'

/**
 * Status colors, never accent-driven. Each theme has its own value so the color reaches 4.5:1 when
 * used as text on that theme's surface and on its own soft tint.
 */
export const semantic = {
  light: { ok: '#007A4A', warn: '#985D00', danger: '#C33632' },
  dark: { ok: '#40B078', warn: '#D98A14', danger: '#F4766C' },
} as const

/**
 * The Mawl teal, for status, online, the computer and success; never for primary actions.
 * `secondary` is the brand value for dots, rings and fills; `secondaryInk` is the text-safe one
 * (light needs a step darker to reach 4.5:1 on the sidebar).
 */
export const secondary = {
  light: { secondary: '#087F86', secondaryInk: '#06767D' },
  dark: { secondary: '#80DACE', secondaryInk: '#80DACE' },
} as const

/**
 * The Mawl primary. White text reaches 5.1:1 on it, so it is the fill in both themes; the accent
 * ink for small text is hand-picked per theme instead of derived (accent.ts pins it).
 */
export const mawlAccent = {
  hex: '#7950E8',
  ink: { light: '#5E32C5', dark: '#BDA4ED' },
} as const

/**
 * Mawl's own primary first, then soft, light accents that take ink text on their fill; the engine
 * derives a darker `--accent-ink` for small text on surfaces. U9 replaces these with palettes.
 */
export const accentPresets = [
  { id: 'mawl', name: 'Mawl', hex: mawlAccent.hex },
  { id: 'sky', name: 'Sky', hex: '#A9D3F5' },
  { id: 'peach', name: 'Peach', hex: '#F7C4A3' },
  { id: 'lilac', name: 'Lilac', hex: '#CBB9F4' },
  { id: 'rose', name: 'Rose', hex: '#F4B6C4' },
  { id: 'slate', name: 'Slate', hex: '#B9C3CF' },
] as const

export type AccentPresetId = (typeof accentPresets)[number]['id']

export const defaultAccent = accentPresets[0]

/**
 * Presets that are gone. Saved preferences that still hold one of these fall back to the default
 * accent, so a retired preset never lingers as an unnamed custom color. The first six predate the
 * 2026-10 redesign; Lime was the mochi's color and left with it.
 */
export const retiredAccentPresets = [
  { id: 'lake', name: 'Lake', hex: '#3D8BFD' },
  { id: 'moss', name: 'Moss', hex: '#3FA36B' },
  { id: 'amber', name: 'Amber', hex: '#E09A1E' },
  { id: 'coral', name: 'Coral', hex: '#EF6F5E' },
  { id: 'plum', name: 'Plum', hex: '#8E6BE8' },
  { id: 'slate', name: 'Slate', hex: '#5B6B82' },
  { id: 'lime', name: 'Lime', hex: '#D8E88A' },
] as const
