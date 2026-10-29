import { durSeconds, ease, spring } from '@mawl/ui'
import { AnimatePresence, motion, useReducedMotionConfig } from 'motion/react'
import { type RefObject, useEffect, useId, useRef, useState } from 'react'
import { cx } from '../ui/cx.ts'
import { ART, BLINKS, type Glyph, GlyphShape, POSES } from './glyphs.tsx'
import type { MascotState } from './states.ts'
import { type OrbColors, type OrbWay, orbColors } from './ways.ts'

export { POSES } from './glyphs.tsx'

/**
 * Mawl, the orb (DESIGN.md §8; art in design/assets/mascot-orb/). One circle, one colourway, and
 * glyph eyes that carry every expression.
 *
 * The state picks the eyes and the effect (see {@link POSES}). Eyes cross-fade and spring between
 * states through Motion; ambient loops (breathing, blink, spin, shake) live in `mawl.css`, keyed on
 * `data-state`. Reduced motion (the OS setting or the in-app toggle, which drives Motion's config)
 * stops the loops and turns the eye changes into short fades.
 */

/** Below this size the soft light is lost and the strokes thin out, so the orb goes flat. */
export const SOFT_FROM = 48
/** Eyes follow the pointer only when the orb is big enough for the glance to read. */
const FOLLOW_FROM = 64
/** Matches `mawl-hop` in mawl.css. */
export const HOP_MS = 550
/** Pointer gaze reach, in artwork units. */
const GAZE = { x: 14, y: 10 }

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
}: {
  /** Rendered width and height in px. */
  size?: number
  state?: MascotState
  way?: OrbWay
  className?: string
}) {
  const gradientId = useGradientId()
  const reduce = useReducedMotionConfig() ?? false
  const svgRef = useRef<SVGSVGElement>(null)
  const lookRef = useRef<SVGGElement>(null)
  const [hopping, setHopping] = useState(false)
  const flat = size < SOFT_FROM
  const pose = POSES[state]
  const colors = orbColors(way)
  const pressable = !flat && !reduce

  usePointerGaze(svgRef, lookRef, state === 'idle' && size >= FOLLOW_FROM && !reduce)

  useEffect(() => {
    if (!hopping) return
    // A timer rather than animationend, so a hidden tab or a missing stylesheet can't strand it.
    const timer = setTimeout(() => setHopping(false), HOP_MS)
    return () => clearTimeout(timer)
  }, [hopping])

  return (
    <svg
      ref={svgRef}
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
      aria-hidden="true"
      focusable="false"
      onClick={pressable ? () => setHopping(true) : undefined}
    >
      <g className="mawl-hop">
        <g className="mawl-motion">
          <g className="mawl-press">
            <OrbBody colors={colors} flat={flat} gradientId={gradientId} />
            <motion.g
              data-part="eyes"
              initial={false}
              animate={{ x: pose.look?.x ?? 0, y: pose.look?.y ?? 0 }}
              transition={spring.gentle}
            >
              <g ref={lookRef} className="mawl-look">
                <AnimatedEye side="l" glyph={pose.l} ink={colors.ink} heavy={flat} />
                <AnimatedEye side="r" glyph={pose.r} ink={colors.ink} heavy={flat} />
              </g>
            </motion.g>
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
}: {
  side: 'l' | 'r'
  glyph: Glyph
  ink: string
  heavy: boolean
}) {
  return (
    <g transform={eyeHome(side)}>
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
          <g className={cx('mawl-glyph', `mawl-glyph-${glyph}`, BLINKS.has(glyph) && 'mawl-blink')}>
            <GlyphShape kind={glyph} ink={ink} heavy={heavy} />
          </g>
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

/**
 * While enabled, the eyes glance toward the pointer, at most once per frame. Disabling it (or
 * unmounting) hands the eyes back to their resting pose.
 */
function usePointerGaze(
  svgRef: RefObject<SVGSVGElement | null>,
  lookRef: RefObject<SVGGElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const look = lookRef.current
    if (!enabled || !look) return
    let frame = 0
    let last: PointerEvent | undefined
    const update = () => {
      frame = 0
      const svg = svgRef.current
      if (!svg || !last) return
      const r = svg.getBoundingClientRect()
      const clamp = (n: number) => Math.max(-1, Math.min(1, n))
      const dx = clamp((last.clientX - (r.left + r.width / 2)) / 180)
      const dy = clamp((last.clientY - (r.top + r.height / 2)) / 180)
      look.style.transform = `translate(${(dx * GAZE.x).toFixed(1)}px, ${(dy * GAZE.y).toFixed(1)}px)`
    }
    const onMove = (e: PointerEvent) => {
      last = e
      if (!frame) frame = requestAnimationFrame(update)
    }
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      if (frame) cancelAnimationFrame(frame)
      look.style.transform = ''
    }
  }, [enabled, svgRef, lookRef])
}
