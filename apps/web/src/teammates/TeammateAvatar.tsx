import { MawlAvatar } from '../mascot/MawlAvatar.tsx'
import type { MascotState } from '../mascot/states.ts'

/**
 * A round, neutral chip holding the simplified Mawl, which wears the teammate's own color
 * (UI-REDESIGN.md §3). The chip stays neutral so the tinted Mawl stands out against it. The color is
 * the teammate's data, not a design token, so it only ever tints: text never sits on it.
 */
export function TeammateAvatar({
  color,
  size = 40,
  state = 'idle',
}: {
  color: string
  size?: number
  state?: MascotState
}) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center overflow-hidden rounded-pill bg-surface-2"
      style={{ width: size, height: size }}
    >
      <MawlAvatar color={color} size={Math.round(size * 0.8)} state={state} />
    </span>
  )
}
