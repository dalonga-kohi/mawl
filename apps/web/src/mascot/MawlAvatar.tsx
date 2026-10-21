import type { CSSProperties } from 'react'
import { cx } from '../ui/cx.ts'
import { BODY_PATH, MawlEyes, POSES, TINY_AT, useSvgIds } from './Mawl.tsx'
import type { MascotState } from './states.ts'

/**
 * The simplified Mawl for chat lists and teammate avatars (UI-REDESIGN.md §3): body, ears and eyes,
 * no mouth, no tail, no motion. A teammate color re-tints it; mawl.css pins the lightness so the
 * dark eyes stay readable whatever the color. Without one it wears Mawl's own lime. The state shows
 * in the eyes only.
 */
export function MawlAvatar({
  color,
  size = 40,
  state = 'idle',
  className,
}: {
  /** The teammate's color (a validated hex). Data, not a token: it only ever tints. */
  color?: string | undefined
  size?: number
  state?: MascotState
  className?: string
}) {
  const ids = useSvgIds()
  const style = color ? ({ '--mawl-tint': color } as CSSProperties) : undefined
  return (
    <svg
      className={cx('mawl-avatar', color && 'is-tinted', size <= TINY_AT && 'is-tiny', className)}
      width={size}
      height={size}
      viewBox="-50 -51 100 100"
      data-state={state}
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      <defs>
        <linearGradient id={ids.body} x1="0.25" y1="0" x2="0.65" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mawl-body-top)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mawl-body-bottom)' }} />
        </linearGradient>
      </defs>
      <g className="mawl-ears">
        <circle cx="-29" cy="-33" r="10" fill="var(--mawl-ear)" />
        <circle cx="29" cy="-33" r="10" fill="var(--mawl-ear)" />
        <circle cx="-29" cy="-34" r="5.5" fill="var(--mawl-ear-inner)" />
        <circle cx="29" cy="-34" r="5.5" fill="var(--mawl-ear-inner)" />
      </g>
      <path data-part="body" d={BODY_PATH} fill={`url(#${ids.body})`} />
      <MawlEyes on={POSES[state].eyes} still />
    </svg>
  )
}
