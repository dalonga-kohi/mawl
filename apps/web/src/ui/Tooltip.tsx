import { Tooltip as RadixTooltip } from 'radix-ui'
import type { ReactNode } from 'react'

/** Wrap the app once; tooltips then open after a short, shared delay. */
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
    {children}
  </RadixTooltip.Provider>
)

export function Tooltip({
  label,
  side = 'bottom',
  children,
}: {
  label: string
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactNode
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-xs bg-text px-2 py-1 text-micro text-bg shadow-2 select-none"
        >
          {label}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
