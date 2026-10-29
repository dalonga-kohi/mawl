import { MawlAvatar } from '../mascot/MawlAvatar.tsx'
import type { MascotState } from '../mascot/states.ts'

/**
 * The teammate's orb, in the colourway its stored colour maps to (DESIGN.md §8). The orb is round
 * already, so it fills the avatar box with no chip behind it. The colour is the teammate's data,
 * not a design token: it only picks a colourway, and text never sits on it.
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
      className="grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <MawlAvatar color={color} size={size} state={state} />
    </span>
  )
}
