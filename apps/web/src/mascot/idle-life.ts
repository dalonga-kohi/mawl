import { ART } from './glyphs.tsx'

/**
 * The orb's idle life (DESIGN.md §8): now and then it looks around on its own and it blinks. No
 * pointer tracking. The schedule is a plain function over an injectable clock, so tests drive it
 * with fake timers and a scripted random sequence.
 */

/** A gaze direction in degrees: yaw turns right (+) or left (-), pitch looks down (+) or up (-). */
export interface Gaze {
  yaw: number
  pitch: number
}

/**
 * Where the orb may look, with how often. Left and right turn far enough that the leading eye
 * slides over the orb's edge and is clipped by it.
 */
export const GAZES = {
  centre: { yaw: 0, pitch: 0, weight: 4 },
  left: { yaw: -43, pitch: 0, weight: 2 },
  right: { yaw: 43, pitch: 0, weight: 2 },
  down: { yaw: 0, pitch: 14, weight: 1 },
  upLeft: { yaw: -30, pitch: -20, weight: 1 },
  upRight: { yaw: 30, pitch: -20, weight: 1 },
} as const satisfies Record<string, Gaze & { weight: number }>

export type GazeName = keyof typeof GAZES

const GAZE_NAMES = Object.keys(GAZES) as GazeName[]
const TOTAL_WEIGHT = GAZE_NAMES.reduce((sum, name) => sum + GAZES[name].weight, 0)

/** Listening looks around half as far, and less often: its attention is on the composer. */
export const QUIET_AMPLITUDE = 0.5

export interface LifeClock {
  /** In [0, 1). */
  random(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(id: unknown): void
}

export const browserClock: LifeClock = {
  random: Math.random,
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id as number),
}

export interface LifeHandlers {
  onGaze(name: GazeName): void
  /** `true` when the eyes close, `false` when they open. */
  onBlink(closed: boolean): void
}

export interface LifeOptions {
  /** The listening variant: rarer looks. */
  quiet?: boolean
  look?: boolean
  blink?: boolean
}

const LOOK_WAIT = { min: 2000, span: 3000 }
const QUIET_LOOK_WAIT = { min: 3500, span: 3500 }
const HOLD = { min: 600, span: 1200 }
const BLINK_WAIT = { min: 3000, span: 3000 }
/** How long the eyes stay closed, and the gap inside a double blink. */
export const BLINK_MS = 120
const DOUBLE_BLINK_CHANCE = 0.2

/** Starts both loops; returns a stop function that clears every pending timer. */
export function startIdleLife(
  clock: LifeClock,
  handlers: LifeHandlers,
  { quiet = false, look = true, blink = true }: LifeOptions = {},
): () => void {
  const pending = new Set<unknown>()
  let stopped = false
  const after = (ms: number, fn: () => void) => {
    const id = clock.setTimeout(() => {
      pending.delete(id)
      if (!stopped) fn()
    }, ms)
    pending.add(id)
  }
  const between = (range: { min: number; span: number }) => range.min + clock.random() * range.span

  const pick = (): GazeName => {
    let r = clock.random() * TOTAL_WEIGHT
    for (const name of GAZE_NAMES) {
      r -= GAZES[name].weight
      if (r < 0) return name
    }
    return 'centre'
  }

  const scheduleLook = () => {
    after(between(quiet ? QUIET_LOOK_WAIT : LOOK_WAIT), () => {
      const name = pick()
      if (name === 'centre') {
        scheduleLook()
        return
      }
      handlers.onGaze(name)
      after(between(HOLD), () => {
        handlers.onGaze('centre')
        scheduleLook()
      })
    })
  }

  const closeOpen = (then: () => void) => {
    handlers.onBlink(true)
    after(BLINK_MS, () => {
      handlers.onBlink(false)
      then()
    })
  }
  const scheduleBlink = () => {
    after(between(BLINK_WAIT), () => {
      const double = clock.random() < DOUBLE_BLINK_CHANCE
      closeOpen(() => {
        if (double) after(BLINK_MS, () => closeOpen(scheduleBlink))
        else scheduleBlink()
      })
    })
  }

  if (look) scheduleLook()
  if (blink) scheduleBlink()
  return () => {
    stopped = true
    for (const id of pending) clock.clearTimeout(id)
    pending.clear()
  }
}

/**
 * The face sits on a sphere a little larger than the drawn orb, so a far gaze carries the leading
 * eye past the outline, where the orb's clip cuts it off.
 */
const SPHERE_R = ART.r * 1.1
const EYE_ANGLE = Math.asin(ART.eyeX / SPHERE_R)
/**
 * Glyphs squash with the square root of the turn, gentler than a true cosine, and never below this,
 * so a leading eye at the edge is cut by the outline rather than thinned to nothing.
 */
const MIN_SQUASH = 0.45
const rad = (deg: number) => (deg * Math.PI) / 180

export interface ProjectedEye {
  x: number
  y: number
  sx: number
  sy: number
}

/**
 * Projects one eye onto the sphere for a gaze (degrees): its screen position, and how much its
 * glyph squashes as it turns away (1 at rest).
 */
export function projectEye(side: 'l' | 'r', yaw: number, pitch: number): ProjectedEye {
  const angle = (side === 'l' ? -EYE_ANGLE : EYE_ANGLE) + rad(yaw)
  const tilt = rad(pitch)
  return {
    x: ART.cx + SPHERE_R * Math.sin(angle) * Math.cos(tilt),
    y: ART.eyeY + SPHERE_R * Math.sin(tilt),
    sx: Math.max(MIN_SQUASH, Math.sqrt(Math.max(0, Math.cos(angle)) / Math.cos(EYE_ANGLE))),
    sy: Math.cos(tilt),
  }
}

/** A resting look offset (artwork units, from POSES) as a gaze on the sphere. */
export function gazeForOffset(offset: { x: number; y: number } | undefined): Gaze {
  if (!offset) return { yaw: 0, pitch: 0 }
  const deg = (v: number) => (Math.asin(Math.max(-1, Math.min(1, v / SPHERE_R))) * 180) / Math.PI
  return { yaw: deg(offset.x), pitch: deg(offset.y) }
}
