import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { IconTile } from './IconTile.tsx'

/**
 * A calm empty state for a page section: a round icon tile, a short title, one plain line and an
 * optional action. The mascot has its own spots (DESIGN.md §8); lists and panels use this instead.
 */
export function EmptyPanel({
  icon,
  title,
  children,
  action,
  headingLevel = 2,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: ReactNode
  headingLevel?: 2 | 3
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-16 text-center sm:py-20">
      <IconTile icon={icon} />
      <Heading className="mt-4 font-display text-title text-balance">{title}</Heading>
      {children ? <p className="max-w-[44ch] text-pretty text-text-2">{children}</p> : null}
      {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}
