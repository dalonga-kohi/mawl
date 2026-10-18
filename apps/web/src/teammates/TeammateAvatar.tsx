import { Beaver, type MascotState } from '../mascot/Beaver.tsx'

/**
 * A rounded square holding Pip, tinted by the teammate's own color (DESIGN.md §6). The color is
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
      className="grid shrink-0 place-items-center overflow-hidden rounded-sm"
      style={{
        width: size,
        height: size,
        background: `color-mix(in oklch, ${color} 22%, var(--surface))`,
      }}
    >
      <Beaver size={Math.round(size * 0.86)} state={state} />
    </span>
  )
}
