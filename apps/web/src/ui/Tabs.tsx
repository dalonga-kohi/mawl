import { Tabs as TabsPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/** shadcn's tabs as a pill track with pill triggers; the active one sits on the surface. */
export function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root data-slot="tabs" className={cn('flex flex-col', className)} {...props} />
  )
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-card bg-surface-2 p-[3px]',
        className,
      )}
      {...props}
    />
  )
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md px-3.5 text-small font-semibold whitespace-nowrap text-text-2 pointer-coarse:h-11',
        'transition-[background-color,color,box-shadow,scale] duration-(--dur-fast) ease-out hover:text-text active:scale-[.97]',
        'data-[state=active]:bg-surface data-[state=active]:text-text data-[state=active]:shadow-1',
        'disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        'focus-visible:outline-offset-[-2px]',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  )
}
