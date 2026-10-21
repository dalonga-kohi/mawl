import { useReducedMotionConfig } from 'motion/react'
import { type CSSProperties, type RefObject, useEffect, useId, useRef, useState } from 'react'
import { cx } from '../ui/cx.ts'
import type { MascotState } from './states.ts'

/**
 * Mawl, the lemon-lime mochi (docs/UI-REDESIGN.md §2-4). Ported from the user's mint reference:
 * the shapes and keyframes are the reference's, recolored with the fixed Mawl palette in
 * `mawl.css`. Every color is a `--mawl-*` variable; none of them follow the accent.
 *
 * The state only picks which eyes, mouth and effect are on (see {@link POSES}); the motion for each
 * state lives in `mawl.css`, keyed on `data-state`. Reduced motion (the OS setting or the in-app
 * toggle, which drives Motion's config) freezes Mawl on its pose.
 */

export type EyeShape = 'line' | 'focus' | 'happy' | 'round' | 'closed'
export type MouthShape = 'smile' | 'wavy' | 'flat' | 'open' | 'o' | 'sleep'
export type Effect = 'dots' | 'chips' | 'sparkles' | 'sweat' | 'zz' | 'alert'

export interface Pose {
  eyes: EyeShape
  mouth: MouthShape
  fx?: Effect
  /** Where the eyes rest, in viewBox units. */
  look?: { x: number; y: number }
}

export const POSES: Record<MascotState, Pose> = {
  idle: { eyes: 'line', mouth: 'smile' },
  // The composer sits below Mawl, so listening glances down at it.
  listening: { eyes: 'line', mouth: 'smile', look: { x: 0, y: 4 } },
  thinking: { eyes: 'line', mouth: 'wavy', fx: 'dots', look: { x: 6, y: -4 } },
  working: { eyes: 'focus', mouth: 'flat', fx: 'chips' },
  waiting: { eyes: 'line', mouth: 'smile', fx: 'alert', look: { x: 3, y: -2 } },
  done: { eyes: 'happy', mouth: 'open', fx: 'sparkles' },
  oops: { eyes: 'round', mouth: 'o', fx: 'sweat' },
  sleepy: { eyes: 'closed', mouth: 'sleep', fx: 'zz' },
}

/** The body outline, shared with {@link MawlAvatar}. */
export const BODY_PATH =
  'M-48 20 C-48 -20 -28 -44 0 -44 C28 -44 48 -20 48 20 C48 36 36 42 0 42 C-36 42 -48 36 -48 20 Z'

const INK = 'var(--mawl-ink)'
const OPEN_MOUTH = 'M-8 8 Q0 8 8 8 Q8 19 0 19 Q-8 19 -8 8 Z'

/** The five eye shapes, shared with {@link MawlAvatar}. */
export function MawlEyes({ on, still }: { on?: EyeShape | undefined; still?: boolean }) {
  const part = (shape: EyeShape) => ({
    'data-part': `eyes-${shape}`,
    'data-on': on === shape ? '' : undefined,
  })
  const stroke = { stroke: INK, strokeLinecap: 'round', fill: 'none' } as const
  return (
    <>
      <g {...part('line')} className={still ? undefined : 'mawl-blink'}>
        <path d="M-13 -7 L-13 1 M13 -7 L13 1" strokeWidth="6" {...stroke} />
      </g>
      <g {...part('focus')}>
        <path d="M-17 -5 L-9 -1.5 M17 -5 L9 -1.5" strokeWidth="5.5" {...stroke} />
      </g>
      <g {...part('happy')}>
        <path
          d="M-18 1 L-13 -6 L-8 1 M8 1 L13 -6 L18 1"
          strokeWidth="5.5"
          strokeLinejoin="round"
          {...stroke}
        />
      </g>
      <g {...part('round')} fill={INK}>
        <circle cx="-13" cy="-3" r="4.5" />
        <circle cx="13" cy="-3" r="4.5" />
      </g>
      <g {...part('closed')}>
        <path d="M-18 -3 Q-13 3 -8 -3 M8 -3 Q13 3 18 -3" strokeWidth="5" {...stroke} />
      </g>
    </>
  )
}

/** At or below this size the eye strokes fall under a pixel, so mawl.css makes them heavier. */
export const TINY_AT = 20
/** Below this width the effects are unreadable, so Mawl drops them and crops to its body. */
const COMPACT_BELOW = 48
/** Eyes follow the pointer only when Mawl is big enough for the glance to read. */
const FOLLOW_FROM = 64
/** Matches `mawl-hop` in mawl.css. */
export const HOP_MS = 550
const FULL_BOX = { x: -85, y: -90, w: 170, h: 150 }
// Body, ears and tail only; overflow stays visible, so a hop or bob may leave the box.
const COMPACT_BOX = { x: -50, y: -46, w: 112, h: 92 }

export function Mawl({
  size = 40,
  state = 'idle',
  className,
}: {
  /** Rendered width in px; the height follows the artwork. */
  size?: number
  state?: MascotState
  className?: string
}) {
  const ids = useSvgIds()
  const reduce = useReducedMotionConfig() ?? false
  const svgRef = useRef<SVGSVGElement>(null)
  const lookRef = useRef<SVGGElement>(null)
  const [hopping, setHopping] = useState(false)
  const compact = size < COMPACT_BELOW
  const pose = POSES[state]
  const box = compact ? COMPACT_BOX : FULL_BOX

  usePointerGaze(svgRef, lookRef, state === 'idle' && size >= FOLLOW_FROM && !reduce)

  useEffect(() => {
    if (!hopping) return
    // A timer rather than animationend, so a hidden tab or a missing stylesheet can't strand it.
    const timer = setTimeout(() => setHopping(false), HOP_MS)
    return () => clearTimeout(timer)
  }, [hopping])

  const on = (part: string, active: boolean) => ({
    'data-part': part,
    'data-on': active ? '' : undefined,
  })
  const mouth = (shape: MouthShape) => on(`mouth-${shape}`, pose.mouth === shape)
  const fx = (kind: Effect) => on(`fx-${kind}`, pose.fx === kind)
  const lineStroke = { stroke: INK, strokeLinecap: 'round', fill: 'none' } as const
  const style = {
    '--mawl-look': pose.look ? `translate(${pose.look.x}px, ${pose.look.y}px)` : 'none',
  } as CSSProperties

  return (
    <svg
      ref={svgRef}
      className={cx(
        'mawl',
        size <= TINY_AT && 'is-tiny',
        reduce && 'is-still',
        hopping && 'is-hopping',
        className,
      )}
      width={size}
      height={Math.round((size * box.h) / box.w)}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      data-state={state}
      aria-hidden="true"
      focusable="false"
      style={style}
      onClick={compact || reduce ? undefined : () => setHopping(true)}
    >
      <defs>
        <linearGradient id={ids.body} x1="0.25" y1="0" x2="0.65" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mawl-body-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mawl-body-bottom)' }} />
        </linearGradient>
        <linearGradient id={ids.tail} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mawl-tail-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mawl-tail-bottom)' }} />
        </linearGradient>
        <clipPath id={ids.mouth}>
          <path d={OPEN_MOUTH} />
        </clipPath>
      </defs>
      {compact ? null : <ellipse className="mawl-shadow" cx="0" cy="46" rx="42" ry="5.5" />}
      <g className="mawl-hop">
        <g className="mawl-bounce">
          <g className="mawl-squish">
            <g className="mawl-tail">
              <ellipse
                cx="46"
                cy="-14"
                rx="12"
                ry="20"
                fill={`url(#${ids.tail})`}
                transform="rotate(28 46 -14)"
              />
            </g>
            <g className="mawl-ears">
              <circle cx="-29" cy="-33" r="10" fill="var(--mawl-ear)" />
              <circle cx="29" cy="-33" r="10" fill="var(--mawl-ear)" />
              <circle cx="-29" cy="-34" r="5.5" fill="var(--mawl-ear-inner)" />
              <circle cx="29" cy="-34" r="5.5" fill="var(--mawl-ear-inner)" />
            </g>
            <g className="mawl-paw">
              <ellipse
                cx="-51"
                cy="-12"
                rx="6.5"
                ry="11"
                fill={`url(#${ids.body})`}
                transform="rotate(-32 -51 -12)"
              />
            </g>
            <path data-part="body" d={BODY_PATH} fill={`url(#${ids.body})`} />
            <g className="mawl-blush" fill="var(--mawl-blush)">
              <ellipse cx="-29" cy="10" rx="6" ry="3.5" />
              <ellipse cx="29" cy="10" rx="6" ry="3.5" />
            </g>
            <g ref={lookRef} className="mawl-look">
              <MawlEyes on={pose.eyes} still={reduce} />
            </g>
            <path {...mouth('smile')} d="M-6 9 Q0 14 6 9" strokeWidth="2.5" {...lineStroke} />
            <path
              {...mouth('wavy')}
              d="M-5 11 Q-2.5 8.5 0 11 Q2.5 13.5 5 11"
              strokeWidth="2.3"
              {...lineStroke}
            />
            <path {...mouth('flat')} d="M-4.5 11 L4.5 11" strokeWidth="2.5" {...lineStroke} />
            <g {...mouth('open')}>
              <path d={OPEN_MOUTH} fill={INK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
              <g clipPath={`url(#${ids.mouth})`}>
                <ellipse cx="0" cy="20" rx="6" ry="5.5" fill="var(--mawl-tongue)" />
              </g>
            </g>
            <ellipse {...mouth('o')} cx="0" cy="12" rx="3" ry="3.6" fill={INK} />
            <path {...mouth('sleep')} d="M-4 10 Q0 12.5 4 10" strokeWidth="2.2" {...lineStroke} />
          </g>
        </g>
      </g>
      {compact ? null : (
        <>
          <g {...fx('dots')} fill="var(--mawl-ear-inner)">
            <circle className="mawl-dot" cx="-10" cy="-66" r="3.2" />
            <circle className="mawl-dot" cx="0" cy="-66" r="3.2" />
            <circle className="mawl-dot" cx="10" cy="-66" r="3.2" />
          </g>
          <g {...fx('chips')} fill="var(--mawl-body-bottom)">
            <g transform="translate(58 -34)">
              <circle className="mawl-chip" r="2.6" />
            </g>
            <g transform="translate(63 -22)">
              <circle className="mawl-chip" r="2.2" />
            </g>
            <g transform="translate(54 -44)">
              <circle className="mawl-chip" r="2" />
            </g>
          </g>
          <g {...fx('sparkles')} fill="var(--mawl-sparkle)">
            <g transform="translate(-52 -50)">
              <path
                className="mawl-sparkle"
                d="M0 -6 Q0.8 -0.8 6 0 Q0.8 0.8 0 6 Q-0.8 0.8 -6 0 Q-0.8 -0.8 0 -6 Z"
              />
            </g>
            <g transform="translate(-62 -14)">
              <path
                className="mawl-sparkle"
                d="M0 -5 Q0.7 -0.7 5 0 Q0.7 0.7 0 5 Q-0.7 0.7 -5 0 Q-0.7 -0.7 0 -5 Z"
              />
            </g>
            <g transform="translate(38 -68)">
              <path
                className="mawl-sparkle"
                d="M0 -6 Q0.8 -0.8 6 0 Q0.8 0.8 0 6 Q-0.8 0.8 -6 0 Q-0.8 -0.8 0 -6 Z"
              />
            </g>
          </g>
          <g {...fx('sweat')} fill="var(--mawl-sweat)">
            <g transform="translate(-42 -30)">
              <path className="mawl-drop" d="M0 -6 C3 -1 4 2 0 4 C-4 2 -3 -1 0 -6 Z" />
            </g>
          </g>
          <g {...fx('zz')} className="mawl-zz">
            <g transform="translate(34 -46)">
              <text fontSize="12">z</text>
            </g>
            <g transform="translate(44 -58)">
              <text fontSize="14">z</text>
            </g>
            <g transform="translate(54 -72)">
              <text fontSize="16">z</text>
            </g>
          </g>
          <g {...fx('alert')}>
            <g className="mawl-bubble">
              <circle cx="31" cy="-49" r="3" fill="var(--mawl-sparkle)" />
              <circle cx="42" cy="-64" r="11" fill="var(--mawl-sparkle)" />
              <path d="M42 -69.5 L42 -63" stroke={INK} strokeWidth="3.2" strokeLinecap="round" />
              <circle cx="42" cy="-58" r="1.9" fill={INK} />
            </g>
          </g>
        </>
      )}
    </svg>
  )
}

/** Gradient and clip ids unique to this instance, so several Mawls never share a `url(#…)`. */
export function useSvgIds() {
  const base = `mawl${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  return { body: `${base}-body`, tail: `${base}-tail`, mouth: `${base}-mouth` }
}

/**
 * While enabled, the eyes glance toward the pointer, at most once per frame. Disabling it (or
 * unmounting) hands the eyes back to the stylesheet's resting pose.
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
      const dy = clamp((last.clientY - (r.top + r.height * 0.6)) / 180)
      look.style.transform = `translate(${(dx * 5).toFixed(1)}px, ${(dy * 3.5).toFixed(1)}px)`
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
