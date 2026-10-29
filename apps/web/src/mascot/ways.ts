/**
 * The orb's colourways (DESIGN.md §8; art source `design/assets/mascot-orb/build.mjs`). Each one is
 * a body colour and an ink for the glyph eyes. These are the mascot's own colours: they never follow
 * the palette or the accent, and this file and `mawl.css` are the only places they live.
 */

export const ORB_WAYS = ['lavender', 'purple', 'night', 'teal', 'peach', 'rose', 'sky'] as const
export type OrbWay = (typeof ORB_WAYS)[number]

export const WAYS: Record<OrbWay, { body: string; ink: string }> = {
  lavender: { body: '#BDA4ED', ink: '#1B1233' },
  purple: { body: '#7950E8', ink: '#F2F5FC' },
  night: { body: '#1B2433', ink: '#BDA4ED' },
  teal: { body: '#80DACE', ink: '#0B2F33' },
  peach: { body: '#F8B79B', ink: '#3A1A10' },
  rose: { body: '#F4A9C0', ink: '#3A1021' },
  sky: { body: '#A9C8F4', ink: '#12264A' },
}

const HEX6 = /^#[0-9a-f]{6}$/i

const rgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}

/** Mixes toward black (0) or white (255) in sRGB, like `mix()` in build.mjs. */
function mix(hex: string, to: number, t: number): string {
  const [r, g, b] = rgb(hex).map((v) => Math.round(v + (to - v) * t)) as [number, number, number]
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export interface OrbColors {
  body: string
  ink: string
  /** The soft treatment's top-left light. */
  hi: string
  /** The soft treatment's bottom-right shade. */
  lo: string
}

export function orbColors(way: OrbWay): OrbColors {
  const { body, ink } = WAYS[way]
  return { body, ink, hi: mix(body, 255, 0.22), lo: mix(body, 0, 0.14) }
}

/**
 * Teammate colours saved before the orb (the old soft accent presets) and the colourway each one
 * now wears. Lime was Mawl's own colour, so it becomes Mawl's own lavender.
 */
const LEGACY: Record<string, OrbWay> = {
  '#D8E88A': 'lavender',
  '#A9D3F5': 'sky',
  '#F7C4A3': 'peach',
  '#CBB9F4': 'purple',
  '#F4B6C4': 'rose',
  '#B9C3CF': 'night',
}

/**
 * The colourway for a teammate's stored colour: an exact colourway or legacy preset first, else
 * the nearest colourway body. The colour is data, so anything that is not a hex falls back.
 */
export function wayForColor(color: string | undefined): OrbWay {
  if (!color || !HEX6.test(color)) return 'lavender'
  const hex = color.toUpperCase()
  const exact = ORB_WAYS.find((w) => WAYS[w].body === hex) ?? LEGACY[hex]
  if (exact) return exact
  const [r, g, b] = rgb(hex)
  let best: OrbWay = 'lavender'
  let bestD = Number.POSITIVE_INFINITY
  for (const way of ORB_WAYS) {
    const [wr, wg, wb] = rgb(WAYS[way].body)
    const d = (r - wr) ** 2 + (g - wg) ** 2 + (b - wb) ** 2
    if (d < bestD) {
      bestD = d
      best = way
    }
  }
  return best
}
