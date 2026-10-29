import { cx } from '../ui/cx.ts'
import { COMPACT_BOX, OrbBody, POSES, SOFT_FROM, StillEye, useGradientId } from './Mawl.tsx'
import type { MascotState } from './states.ts'
import { type OrbWay, orbColors, wayForColor } from './ways.ts'

/**
 * The orb for chat lists and teammate avatars: body and eyes, no effects, no motion. A teammate
 * wears the colourway its stored colour maps to (see {@link wayForColor}); without one it wears
 * Mawl's own lavender. The state shows in the eyes only.
 */
export function MawlAvatar({
  color,
  way,
  size = 40,
  state = 'idle',
  className,
}: {
  /** The teammate's stored colour (a validated hex). Data, not a token: it only picks a colourway. */
  color?: string | undefined
  /** An explicit colourway; wins over `color`. */
  way?: OrbWay | undefined
  size?: number
  state?: MascotState
  className?: string
}) {
  const gradientId = useGradientId()
  const resolved = way ?? wayForColor(color)
  const colors = orbColors(resolved)
  const flat = size < SOFT_FROM
  const pose = POSES[state]
  return (
    <svg
      className={cx('mawl-avatar', flat && 'is-flat', className)}
      width={size}
      height={size}
      viewBox={COMPACT_BOX}
      data-state={state}
      data-way={resolved}
      aria-hidden="true"
      focusable="false"
    >
      <OrbBody colors={colors} flat={flat} gradientId={gradientId} />
      <StillEye side="l" glyph={pose.l} ink={colors.ink} heavy={flat} />
      <StillEye side="r" glyph={pose.r} ink={colors.ink} heavy={flat} />
    </svg>
  )
}
