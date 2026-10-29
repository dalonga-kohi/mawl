import { durSeconds, ease, spring } from '@mawl/ui'
import {
  AnimatePresence,
  type MotionValue,
  motion,
  useReducedMotionConfig,
  useSpring,
  useTransform,
} from 'motion/react'
import { type ReactNode, useEffect, useId, useState } from 'react'
import { cx } from '../ui/cx.ts'
import { ART, BLINKS, type Glyph, GlyphShape, POSES } from './glyphs.tsx'
import {
  BLINK_MS,
  browserClock,
  GAZES,
  type GazeName,
  gazeForOffset,
  type LifeClock,
  type ProjectedEye as ProjectedEyeValues,
  projectEye,
  QUIET_AMPLITUDE,
  startIdleLife,
} from './idle-life.ts'
import type { MascotState } from './states.ts'
import { type OrbColors, type OrbWay, orbColors } from './ways.ts'

export { POSES } from './glyphs.tsx'

/**
 * Mawl, the orb (DESIGN.md §8; art in design/assets/mascot-orb/). One circle, one colourway, and
 * glyph eyes that carry every expression.
 *
 * The state picks the eyes and the effect (see {@link POSES}). The eyes sit on a sphere: one gaze
 * (yaw and pitch, Motion springs) is the single source of truth, and each eye's position and squash
 * are projected from it (`projectEye`), inside a clip of the orb, so a far look carries the leading
 * eye over the edge. While idle (and, quieter, while listening) the orb looks around and blinks on
 * its own (`idle-life.ts`). Eyes cross-fade and spring between states; ambient loops live in
 * `mawl.css`, keyed on `data-state`. Reduced motion (the OS setting or the in-app toggle, which
 * drives Motion's config) stops the loops and the idle life and turns eye changes into short fades.
 */

/** Below this size the soft light is lost and the strokes thin out, so the orb goes flat and still. */
export const SOFT_FROM = 48
/** Matches `mawl-hop` in mawl.css. */
export const HOP_MS = 550
const GAZE_SPRING = { stiffness: spring.gentle.stiffness, damping: spring.gentle.damping }

/**
 * The whole artwork, with room for the effects up and to the right. Mawl keeps it at every size,
 * so the orb stays 82.5 % of the box and does not jump when it goes flat under 48 px.
 */
const FULL_BOX = '0 0 400 400'
/** Just the orb, for the still avatar (which never shows effects). */
export const COMPACT_BOX = '33 33 334 334'

export function Mawl({
  size = 40,
  state = 'idle',
  way = 'lavender',
  className,
  clock = browserClock,
}: {
  /** Rendered width and height in px. */
  size?: number
  state?: MascotState
  way?: OrbWay
  className?: string
  /** The idle-life clock; tests pass fake timers and a scripted random. */
  clock?: LifeClock
}) {
  const ids = useOrbIds()
  const reduce = useReducedMotionConfig() ?? false
  const [hopping, setHopping] = useState(false)
  const flat = size < SOFT_FROM
  const pose = POSES[state]
  const colors = orbColors(way)
  const pressable = !flat && !reduce
  const alive = !flat && !reduce && (state === 'idle' || state === 'listening')
  const quiet = state === 'listening'
  const life = useIdleLife(alive, quiet, clock)

  const rest = gazeForOffset(pose.look)
  const look = GAZES[life.gaze]
  const amp = quiet ? QUIET_AMPLITUDE : 1
  const target = { yaw: rest.yaw + look.yaw * amp, pitch: rest.pitch + look.pitch * amp }
  const yaw = useSpring(target.yaw, GAZE_SPRING)
  const pitch = useSpring(target.pitch, GAZE_SPRING)
  useEffect(() => {
    if (reduce) {
      yaw.jump(target.yaw)
      pitch.jump(target.pitch)
    } else {
      yaw.set(target.yaw)
      pitch.set(target.pitch)
    }
  }, [reduce, target.yaw, target.pitch, yaw, pitch])

  useEffect(() => {
    if (!hopping) return
    // A timer rather than animationend, so a hidden tab or a missing stylesheet can't strand it.
    const timer = setTimeout(() => setHopping(false), HOP_MS)
    return () => clearTimeout(timer)
  }, [hopping])

  return (
    <svg
      className={cx(
        'mawl',
        flat && 'is-flat',
        reduce && 'is-still',
        pressable && 'is-pressable',
        hopping && 'is-hopping',
        className,
      )}
      width={size}
      height={size}
      viewBox={FULL_BOX}
      data-state={state}
      data-way={way}
      data-gaze={life.gaze}
      data-blink={life.closed ? '' : undefined}
      aria-hidden="true"
      focusable="false"
      onClick={pressable ? () => setHopping(true) : undefined}
    >
      <defs>
        <clipPath id={ids.clip}>
          <circle cx={ART.cx} cy={ART.cy} r={ART.r} />
        </clipPath>
      </defs>
      <g className="mawl-hop">
        <g className="mawl-motion">
          <g className="mawl-press">
            <OrbBody colors={colors} flat={flat} gradientId={ids.gradient} />
            <g data-part="face" clipPath={`url(#${ids.clip})`}>
              {(['l', 'r'] as const).map((side) => (
                <ProjectedEye key={side} side={side} yaw={yaw} pitch={pitch}>
                  <AnimatedEye
                    side={side}
                    glyph={side === 'l' ? pose.l : pose.r}
                    ink={colors.ink}
                    heavy={flat}
                    closed={life.closed}
                  />
                </ProjectedEye>
              ))}
            </g>
          </g>
        </g>
      </g>
      {flat ? null : (
        <AnimatePresence initial={false}>
          {pose.fx ? (
            <motion.g
              key={pose.fx}
              data-part={`fx-${pose.fx}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: durSeconds.base, ease: ease.out } }}
              exit={{ opacity: 0, transition: { duration: durSeconds.fast, ease: ease.out } }}
            >
              <OrbEffect kind={pose.fx} body={colors.body} />
            </motion.g>
          ) : null}
        </AnimatePresence>
      )}
    </svg>
  )
}

/**
 * Places one eye where the gaze projects it on the sphere, squashed as it turns away. Transform
 * only: x, y and scale are derived from the two gaze springs, so nothing re-renders per frame.
 */
function ProjectedEye({
  side,
  yaw,
  pitch,
  children,
}: {
  side: 'l' | 'r'
  yaw: MotionValue<number>
  pitch: MotionValue<number>
  children: ReactNode
}) {
  const x = useProjected(side, yaw, pitch, 'x')
  const y = useProjected(side, yaw, pitch, 'y')
  const scaleX = useProjected(side, yaw, pitch, 'sx')
  const scaleY = useProjected(side, yaw, pitch, 'sy')
  return (
    <motion.g
      data-part="eye-anchor"
      // Scale about the eye's own centre: the glyph is drawn around (0, 0) and the anchor carries
      // no other transform, so origin 0 0 of the view box is that centre before the translate.
      style={{ x, y, scaleX, scaleY, originX: 0, originY: 0, transformBox: 'view-box' }}
    >
      {children}
    </motion.g>
  )
}

function useProjected(
  side: 'l' | 'r',
  yaw: MotionValue<number>,
  pitch: MotionValue<number>,
  key: keyof ProjectedEyeValues,
) {
  return useTransform([yaw, pitch], ([y, p]: number[]) => projectEye(side, y ?? 0, p ?? 0)[key])
}

/** The idle life while `enabled`, paused while the tab is hidden; centre and open eyes otherwise. */
function useIdleLife(enabled: boolean, quiet: boolean, clock: LifeClock) {
  const [gaze, setGaze] = useState<GazeName>('centre')
  const [closed, setClosed] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let stop: (() => void) | undefined
    const start = () => {
      stop ??= startIdleLife(clock, { onGaze: setGaze, onBlink: setClosed }, { quiet })
    }
    const halt = () => {
      stop?.()
      stop = undefined
      setGaze('centre')
      setClosed(false)
    }
    const onVisibility = () => (document.visibilityState === 'hidden' ? halt() : start())
    if (document.visibilityState !== 'hidden') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      halt()
    }
  }, [enabled, quiet, clock])
  return { gaze, closed }
}

/** The circle, soft (a top-left light) from 48 px and flat below. */
export function OrbBody({
  colors,
  flat,
  gradientId,
}: {
  colors: OrbColors
  flat: boolean
  gradientId: string
}) {
  return (
    <>
      {flat ? null : (
        <defs>
          <radialGradient id={gradientId} cx=".34" cy=".28" r=".85">
            <stop offset="0" stopColor={colors.hi} />
            <stop offset=".55" stopColor={colors.body} />
            <stop offset="1" stopColor={colors.lo} />
          </radialGradient>
        </defs>
      )}
      <circle
        data-part="body"
        cx={ART.cx}
        cy={ART.cy}
        r={ART.r}
        fill={flat ? colors.body : `url(#${gradientId})`}
      />
    </>
  )
}

const eyeHome = (side: 'l' | 'r') =>
  `translate(${ART.cx + (side === 'l' ? -ART.eyeX : ART.eyeX)} ${ART.eyeY})`

/** A still eye, for the avatar. */
export function StillEye({
  side,
  glyph,
  ink,
  heavy,
}: {
  side: 'l' | 'r'
  glyph: Glyph
  ink: string
  heavy: boolean
}) {
  return (
    <g transform={eyeHome(side)}>
      <g data-part="eye" data-side={side} data-glyph={glyph}>
        <GlyphShape kind={glyph} ink={ink} heavy={heavy} />
      </g>
    </g>
  )
}

/**
 * The new glyph pops in on a bouncy spring while the old one fades out over `dur.fast`, so a state
 * change reads at once. Under reduced motion Motion drops the scale and keeps the fade.
 */
function AnimatedEye({
  side,
  glyph,
  ink,
  heavy,
  closed,
}: {
  side: 'l' | 'r'
  glyph: Glyph
  ink: string
  heavy: boolean
  closed: boolean
}) {
  const blinks = BLINKS.has(glyph)
  return (
    <g>
      <AnimatePresence initial={false}>
        <motion.g
          key={glyph}
          data-part="eye"
          data-side={side}
          data-glyph={glyph}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{
            opacity: 1,
            scale: 1,
            transition: { opacity: { duration: durSeconds.fast }, scale: spring.bouncy },
          }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: durSeconds.fast } }}
        >
          <motion.g
            className={cx('mawl-glyph', `mawl-glyph-${glyph}`, blinks && 'mawl-blink')}
            initial={false}
            animate={{ scaleY: blinks && closed ? 0.1 : 1 }}
            transition={{ duration: BLINK_MS / 2000 }}
          >
            <GlyphShape kind={glyph} ink={ink} heavy={heavy} />
          </motion.g>
        </motion.g>
      </AnimatePresence>
    </g>
  )
}

/** The marks around a large orb (build.mjs `extra`), in the body colour. */
function OrbEffect({ kind, body }: { kind: 'think' | 'ask' | 'z'; body: string }) {
  if (kind === 'think')
    return (
      <g fill={body}>
        <circle className="mawl-dot" cx="350" cy="92" r="7" />
        <circle className="mawl-dot" cx="372" cy="62" r="10" />
      </g>
    )
  if (kind === 'ask')
    return (
      <text className="mawl-mark mawl-ask" x="318" y="76" fontSize="54" fill={body}>
        ?!
      </text>
    )
  return (
    <g className="mawl-mark" fill={body}>
      <text className="mawl-z" x="322" y="92" fontSize="44">
        z
      </text>
      <text className="mawl-z" x="354" y="58" fontSize="30">
        z
      </text>
    </g>
  )
}

/** A gradient id unique to this instance, so several orbs never share a `url(#…)`. */
export function useGradientId() {
  return `mawl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-soft`
}

/** Clip and gradient ids unique to this instance, so several orbs never share a `url(#…)`. */
function useOrbIds() {
  const base = `mawl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return { gradient: `${base}-soft`, clip: `${base}-face` }
}
