import type { ReactNode } from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import type { MascotState } from '../mascot/states.ts'

/** DESIGN.md §9: the mascot, one plain line about the state, and the next action. */
export function EmptyState({
  title,
  children,
  mascot = 'idle',
  mascotSize = 112,
  action,
  headingLevel = 2,
}: {
  title: string
  children?: ReactNode
  mascot?: MascotState
  mascotSize?: number
  action?: ReactNode
  headingLevel?: 1 | 2 | 3
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div className="flex max-w-[42ch] flex-col items-center gap-2">
        <Mawl size={mascotSize} state={mascot} />
        <Heading className="mt-3 font-display text-title text-balance">{title}</Heading>
        {children ? <div className="text-pretty text-text-2">{children}</div> : null}
        {action ? <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div> : null}
      </div>
    </div>
  )
}
