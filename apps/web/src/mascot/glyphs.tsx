import type { MascotState } from './states.ts'

/**
 * The orb's glyph eyes (art source: `GLYPH` in design/assets/mascot-orb/build.mjs). Each glyph is
 * drawn around (0, 0) and is roughly 44 units wide, in the orb's 400-unit artwork.
 */
export type Glyph = 'bar' | 'short' | 'ring' | 'star' | 'plus' | 'up' | 'x' | 'l' | 'r'
export type Effect = 'think' | 'ask' | 'z'

export interface Pose {
  l: Glyph
  r: Glyph
  /** Where both eyes rest, in artwork units, relative to their home. */
  look?: { x: number; y: number }
  fx?: Effect
}

export const POSES: Record<MascotState, Pose> = {
  idle: { l: 'bar', r: 'bar' },
  // The composer sits below the orb, so listening glances down at it with shorter bars.
  listening: { l: 'short', r: 'short', look: { x: 0, y: 12 } },
  thinking: { l: 'ring', r: 'ring', look: { x: 10, y: -14 }, fx: 'think' },
  working: { l: 'star', r: 'star' },
  waiting: { l: 'plus', r: 'plus', fx: 'ask' },
  done: { l: 'up', r: 'up' },
  oops: { l: 'x', r: 'x' },
  sleepy: { l: 'l', r: 'r', fx: 'z' },
}

/** Bar eyes blink; the others hold. */
export const BLINKS = new Set<Glyph>(['bar', 'short'])

/** The artwork: a 400-unit box with the orb centred. */
export const ART = { cx: 200, cy: 200, r: 165, eyeX: 62, eyeY: 226 } as const

/**
 * One glyph in `ink`. `heavy` is for the flat orb under 48 px, where the art's 15-unit strokes
 * fall under a pixel: the glyph is drawn a third larger with thicker strokes, so it still reads.
 */
export function GlyphShape({ kind, ink, heavy }: { kind: Glyph; ink: string; heavy: boolean }) {
  const shape = <GlyphPath kind={kind} ink={ink} heavy={heavy} />
  return heavy ? <g transform="scale(1.3)">{shape}</g> : shape
}

function GlyphPath({ kind, ink, heavy }: { kind: Glyph; ink: string; heavy: boolean }) {
  const sw = heavy ? 20 : 15
  const stroke = {
    fill: 'none',
    stroke: ink,
    strokeWidth: sw,
    strokeLinejoin: 'miter',
  } as const
  switch (kind) {
    case 'bar':
    case 'short': {
      const w = heavy ? 24 : 18
      const h = kind === 'bar' ? 52 : 34
      return <rect x={-w / 2} y={-h / 2} width={w} height={h} rx={w / 2} fill={ink} />
    }
    case 'up':
      return <path d="M-22 12L0 -14L22 12" {...stroke} />
    case 'x':
      return <path d="M-18 -18L18 18M18 -18L-18 18" {...stroke} />
    case 'plus':
      return <path d="M-21 0H21M0 -21V21" {...stroke} />
    case 'star':
      return (
        <>
          {[0, 60, 120].map((a) => (
            <path
              key={a}
              d="M0 -22V22"
              {...stroke}
              strokeWidth={heavy ? 16 : 12}
              transform={`rotate(${a})`}
            />
          ))}
        </>
      )
    case 'ring':
      return <circle r="16" {...stroke} strokeWidth={heavy ? 15 : 11} />
    case 'l':
      return <path d="M-22 14V-6H22" {...stroke} />
    case 'r':
      return <path d="M22 14V-6H-22" {...stroke} />
  }
}
