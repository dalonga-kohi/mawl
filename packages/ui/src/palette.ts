import { clampChroma, converter, formatHex, wcagContrast } from 'culori'

/**
 * The named palettes from docs/DESIGN.md §3 (PLAN U9). Each palette ships hand-checked colors for
 * light and dark; nothing is derived from a user-picked accent any more. Components use the CSS
 * variables generated from these (tokens.css), never these values. The orb mascot's colourways live
 * with the mascot (apps/web/src/mascot/ways.ts), not here.
 */

export type ThemeName = 'light' | 'dark'

/**
 * One palette in one theme. `bg` is the app background, `surface` the card, `surface2` the sidebar
 * (also hover and selected fills, chips and wells). `primary` is the filled-button color and
 * `onPrimary` its text; `accentInk` is the primary as small text, links and icons. `secondary` is
 * the status/online/computer color for fills and UI, `secondaryInk` its text-safe step.
 */
export interface PaletteColors {
  bg: string
  surface: string
  surface2: string
  line: string
  text: string
  text2: string
  text3: string
  primary: string
  onPrimary: string
  accentInk: string
  secondary: string
  secondaryInk: string
  ok: string
  warn: string
  danger: string
  info: string
}

export const PALETTE_IDS = [
  'mawl',
  'dracula',
  'catppuccin',
  'gruvbox',
  'claude',
  'rose-pine',
  'nord',
] as const

export type PaletteId = (typeof PALETTE_IDS)[number]

export interface Palette {
  id: PaletteId
  name: string
  light: PaletteColors
  dark: PaletteColors
}

export const DEFAULT_PALETTE_ID: PaletteId = 'mawl'

export const isPaletteId = (value: unknown): value is PaletteId =>
  typeof value === 'string' && (PALETTE_IDS as readonly string[]).includes(value)

/**
 * Where an official color failed the contrast bar (DESIGN.md §3), the value here is the nearest
 * step of the same hue that passes; the comment names the official value it replaces.
 */
export const palettes: Record<PaletteId, Palette> = {
  mawl: {
    id: 'mawl',
    name: 'Mawl',
    /** Cool paper with white cards. */
    light: {
      bg: '#F5F7FC',
      surface: '#FFFFFF',
      surface2: '#EBEFF7',
      line: '#DCE2EE',
      text: '#1B2432',
      text2: '#58677D',
      text3: '#606D83',
      primary: '#7950E8',
      onPrimary: '#FFFFFF',
      accentInk: '#5E32C5',
      secondary: '#087F86',
      secondaryInk: '#06767D',
      ok: '#007A4A',
      warn: '#985D00',
      danger: '#C33632',
      info: '#5E32C5',
    },
    /** Deep navy, with hairline borders instead of shadows. */
    dark: {
      bg: '#0B1019',
      surface: '#1B2433',
      surface2: '#121926',
      line: '#273246',
      text: '#F2F5FC',
      text2: '#A7B2C4',
      text3: '#8390A4',
      primary: '#7950E8',
      onPrimary: '#FFFFFF',
      accentInk: '#BDA4ED',
      secondary: '#80DACE',
      secondaryInk: '#80DACE',
      ok: '#40B078',
      warn: '#D98A14',
      danger: '#F4766C',
      info: '#BDA4ED',
    },
  },
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    /** Alucard, Dracula's official light theme. */
    light: {
      bg: '#FFFBEB',
      surface: '#FFFEF8',
      surface2: '#F4EFD9',
      line: '#E2DCC4',
      text: '#1F1F1F',
      text2: '#4F4A36',
      text3: '#635D44', // comment #6C664B
      primary: '#644AC9',
      onPrimary: '#FFFFFF',
      accentInk: '#6045C4', // purple #644AC9
      secondary: '#036A96',
      secondaryInk: '#036A96',
      ok: '#14710A',
      warn: '#8F4311', // orange #A34D14
      danger: '#B8301F', // red #CB3A2A
      info: '#036A96',
    },
    /** Dracula: background, the darker sidebar tone, current line as the card. */
    dark: {
      bg: '#282A36',
      surface: '#343746',
      surface2: '#21222C',
      line: '#44475A',
      text: '#F8F8F2',
      text2: '#D2D3DE',
      text3: '#A9B0D3', // comment #6272A4
      primary: '#BD93F9',
      onPrimary: '#21222C',
      accentInk: '#C8A3FF', // purple #BD93F9
      secondary: '#8BE9FD',
      secondaryInk: '#8BE9FD',
      ok: '#50FA7B',
      warn: '#FFB86C',
      danger: '#FF958B', // red #FF5555
      info: '#8BE9FD',
    },
  },
  catppuccin: {
    id: 'catppuccin',
    name: 'Catppuccin',
    /** Latte. */
    light: {
      bg: '#EFF1F5',
      surface: '#FBFBFD',
      surface2: '#E6E9EF',
      line: '#CCD0DA',
      text: '#4C4F69',
      text2: '#5C5F77',
      text3: '#5E6178', // subtext0 #6C6F85
      primary: '#8839EF',
      onPrimary: '#FFFFFF',
      accentInk: '#7728DC', // mauve #8839EF
      secondary: '#147D83', // teal #179299
      secondaryInk: '#0E6D72',
      ok: '#2B781A', // green #40A02B
      warn: '#8F5A0E', // yellow #DF8E1D
      danger: '#C00D33', // red #D20F39
      info: '#1A55D0', // blue #1E66F5
    },
    /** Mocha: base, mantle as the sidebar, surface0 as the card. */
    dark: {
      bg: '#1E1E2E',
      surface: '#313244',
      surface2: '#181825',
      line: '#45475A',
      text: '#CDD6F4',
      text2: '#BAC2DE',
      text3: '#A6ADC8',
      primary: '#CBA6F7',
      onPrimary: '#11111B',
      accentInk: '#CBA6F7',
      secondary: '#94E2D5',
      secondaryInk: '#94E2D5',
      ok: '#A6E3A1',
      warn: '#F9E2AF',
      danger: '#F58DAA', // red #F38BA8
      info: '#89B4FA',
    },
  },
  gruvbox: {
    id: 'gruvbox',
    name: 'Gruvbox',
    /** Gruvbox light: bg0, bg0_s as the sidebar, bg0_h as the card, faded accents. */
    light: {
      bg: '#FBF1C7',
      surface: '#F9F5D7',
      surface2: '#F2E5BC',
      line: '#E0D2A8',
      text: '#3C3836',
      text2: '#504945',
      text3: '#5E554E', // fg3 #665C54
      primary: '#AF3A03',
      onPrimary: '#FFFFFF',
      accentInk: '#A03300', // orange #AF3A03
      secondary: '#427B58',
      secondaryInk: '#2F6744', // aqua #427B58
      ok: '#5F5B0A', // green #79740E
      warn: '#8A5A0F', // yellow #B57614
      danger: '#9D0006',
      info: '#076678',
    },
    /** Gruvbox dark: bg, bg0_h as the sidebar, bg1 as the card, bright accents. */
    dark: {
      bg: '#282828',
      surface: '#3C3836',
      surface2: '#1D2021',
      line: '#504945',
      text: '#EBDBB2',
      text2: '#D5C4A1',
      text3: '#BDAE93',
      primary: '#FE8019',
      onPrimary: '#1D2021',
      accentInk: '#FF9C4E', // orange #FE8019
      secondary: '#8EC07C',
      secondaryInk: '#90C27E', // aqua #8EC07C
      ok: '#B8BB26',
      warn: '#FABD2F',
      danger: '#FF998B', // red #FB4934
      info: '#9BBCAF', // blue #83A598
    },
  },
  claude: {
    id: 'claude',
    name: 'Claude',
    /** Warm clay on cream. */
    light: {
      bg: '#FAF9F5',
      surface: '#FFFFFF',
      surface2: '#F0EEE6',
      line: '#E3E0D5',
      text: '#1F1E1D',
      text2: '#4D4C48',
      text3: '#5E5D58',
      primary: '#B5512F', // clay #C96442
      onPrimary: '#FFFFFF',
      accentInk: '#9E4425',
      secondary: '#2E7D74',
      secondaryInk: '#246A62',
      ok: '#2F6F3A',
      warn: '#8A5A00',
      danger: '#B3261E',
      info: '#2F5F9E',
    },
    /** Warm ink. */
    dark: {
      bg: '#262624',
      surface: '#30302E',
      surface2: '#1F1E1D',
      line: '#3E3E3A',
      text: '#FAF9F5',
      text2: '#D2D0C7',
      text3: '#ABA9A0',
      primary: '#D97757',
      onPrimary: '#1F1E1D',
      accentInk: '#E89276', // clay #D97757
      secondary: '#7FC3B4',
      secondaryInk: '#7FC3B4',
      ok: '#8BCB8F',
      warn: '#E8B45A',
      danger: '#F28B7D',
      info: '#8FB5E8',
    },
  },
  'rose-pine': {
    id: 'rose-pine',
    name: 'Rosé Pine',
    /** Dawn: base, overlay as the sidebar, surface as the card. */
    light: {
      bg: '#FAF4ED',
      surface: '#FFFAF3',
      surface2: '#F2E9E1',
      line: '#DFDAD9',
      text: '#575279',
      text2: '#625D82', // subtle #797593
      text3: '#67628A', // muted #9893A5
      primary: '#7A5F9A', // iris #907AA9
      onPrimary: '#FFFFFF',
      accentInk: '#6B508D', // iris #907AA9
      secondary: '#286983',
      secondaryInk: '#286983',
      ok: '#286983',
      warn: '#8D5A12', // gold #EA9D34
      danger: '#9C4A61', // love #B4637A
      info: '#496C77', // foam #56949F
    },
    /** Main: base, surface as the sidebar, overlay as the card. */
    dark: {
      bg: '#191724',
      surface: '#26233A',
      surface2: '#1F1D2E',
      line: '#403D52',
      text: '#E0DEF4',
      text2: '#B8B5D0', // subtle #908CAA
      text3: '#A29EBD', // muted #6E6A86
      primary: '#C4A7E7',
      onPrimary: '#191724',
      accentInk: '#C4A7E7',
      secondary: '#9CCFD8',
      secondaryInk: '#9CCFD8',
      ok: '#9CCFD8',
      warn: '#F6C177',
      danger: '#EF7295', // love #EB6F92
      info: '#EBBCBA',
    },
  },
  nord: {
    id: 'nord',
    name: 'Nord',
    /** Derived from Snow Storm: nord6 as bg, nord5 as the sidebar, a white card. */
    light: {
      bg: '#ECEFF4',
      surface: '#FAFBFC',
      surface2: '#E5E9F0',
      line: '#D8DEE9',
      text: '#2E3440',
      text2: '#434C5E',
      text3: '#4C566A',
      primary: '#4C6E99', // nord10 #5E81AC
      onPrimary: '#FFFFFF',
      accentInk: '#3F5E87', // nord10 #5E81AC
      secondary: '#3F7C7B', // nord7 #8FBCBB
      secondaryInk: '#346A69',
      ok: '#4A6B33', // nord14 #A3BE8C
      warn: '#7F5D14', // nord13 #EBCB8B
      danger: '#A3404A', // nord11 #BF616A
      info: '#4A6A93', // nord10 #5E81AC
    },
    /** Polar Night: nord0 as bg, a darker derived sidebar, nord1 as the card. */
    dark: {
      bg: '#2E3440',
      surface: '#3B4252',
      surface2: '#272C36',
      line: '#4C566A',
      text: '#ECEFF4',
      text2: '#D8DEE9',
      text3: '#B3BCCB', // nord3 #4C566A is too dark for text
      primary: '#88C0D0',
      onPrimary: '#2E3440',
      accentInk: '#95CDDD', // nord8 #88C0D0
      secondary: '#8FBCBB',
      secondaryInk: '#9BC9C8', // nord7 #8FBCBB
      ok: '#AFCB98', // nord14 #A3BE8C
      warn: '#EBCB8B',
      danger: '#FBACB3', // nord11 #BF616A
      info: '#ABC4DD', // nord9 #81A1C1
    },
  },
}

export const paletteList: readonly Palette[] = PALETTE_IDS.map((id) => palettes[id])

/**
 * Percentages for the color-mix() tints in tokens.css, per theme. `ring` mixes `--accent-ink` (not
 * the fill) so the focus ring reaches 3:1 on every surface.
 */
export const themeTints = {
  light: { soft: 24, softer: 12, ring: 100 },
  dark: { soft: 14, softer: 7, ring: 80 },
} as const satisfies Record<ThemeName, { soft: number; softer: number; ring: number }>

const toOklch = converter('oklch')
const HOVER_STEP = 0.04
const PRESS_STEP = 0.08

/**
 * Hover and press for the primary fill: 4% and 8% of OKLCH lightness away from the text color, so
 * each state only adds contrast (white text darkens the fill, dark text lightens it).
 */
export function primaryStates(c: Pick<PaletteColors, 'primary' | 'onPrimary'>): {
  hover: string
  press: string
} {
  const fill = toOklch(c.primary)
  if (!fill) throw new Error(`invalid primary ${c.primary}`)
  const direction =
    wcagContrast(c.onPrimary, '#000000') > wcagContrast(c.onPrimary, '#FFFFFF') ? -1 : 1
  const at = (step: number) =>
    formatHex(
      clampChroma({ ...fill, l: Math.min(1, Math.max(0, fill.l + direction * step)) }, 'oklch'),
    ).toUpperCase()
  return { hover: at(HOVER_STEP), press: at(PRESS_STEP) }
}
