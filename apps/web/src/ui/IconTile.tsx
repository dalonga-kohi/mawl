import type { LucideIcon } from 'lucide-react'
import { cn } from './cn.ts'

/** A calm round tile with one icon: the quiet stand-in for a picture in empty and list states. */
export function IconTile({
  icon: Icon,
  size = 72,
  iconSize = 48,
  className,
}: {
  icon: LucideIcon
  /** Circle diameter in px. */
  size?: number
  iconSize?: number
  className?: string
}) {
  return (
    <span
      data-slot="icon-tile"
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn(
        'grid shrink-0 place-items-center rounded-pill bg-surface-2 text-text-3',
        className,
      )}
    >
      <Icon size={iconSize} strokeWidth={1.5} />
    </span>
  )
}
