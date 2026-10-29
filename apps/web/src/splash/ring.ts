/**
 * The splash's progress ring (U14): three arcs around the orb, one per boot step, each ending in a
 * glyph bead. The first arc starts at the top and runs clockwise, so the last bead (Ready) closes
 * the ring at the top, where the orb's crown is. Units are px in a square box of `RING.box`.
 */
export const RING = {
  box: 208,
  /** Radius of the arcs' centre line. */
  r: 84,
  /** Radius of a bead. */
  bead: 12,
  /** Room left on each side of a bead, in degrees. */
  gapDeg: 12,
} as const

export interface Point {
  x: number
  y: number
}

const centre = RING.box / 2

/** A point on the ring at `deg` (0 = right, clockwise, like SVG). Rounded for stable markup. */
export function onRing(deg: number, r: number = RING.r): Point {
  const rad = (deg * Math.PI) / 180
  const round = (v: number) => Math.round(v * 100) / 100
  return { x: round(centre + r * Math.cos(rad)), y: round(centre + r * Math.sin(rad)) }
}

/** Where step `i` (0-2) ends: its bead. Step 2 lands at the top (-90 degrees). */
export function beadAngle(i: number): number {
  return -90 + 120 * (i + 1)
}

/** The arc of step `i`: from the previous bead to this one, clear of both beads. */
export function arcPath(i: number): string {
  const end = beadAngle(i) - RING.gapDeg
  const start = beadAngle(i) - 120 + RING.gapDeg
  const a = onRing(start)
  const b = onRing(end)
  // Under 180 degrees, clockwise (sweep 1).
  return `M ${a.x} ${a.y} A ${RING.r} ${RING.r} 0 0 1 ${b.x} ${b.y}`
}

export type BeadState = 'todo' | 'active' | 'done'

/** Each step's state from how many finished and whether the next one runs. */
export function beadStates(done: number, active: boolean): BeadState[] {
  return [0, 1, 2].map((i) => (i < done ? 'done' : i === done && active ? 'active' : 'todo'))
}
