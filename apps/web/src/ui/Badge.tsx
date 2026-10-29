import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type { ComponentProps } from 'react'
import { cn } from './cn.ts'

/** shadcn's badge: a small pill for counts and status. Status badges pair color with text. */
export const badgeVariants = cva(
  'inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 rounded-sm px-2 text-micro whitespace-nowrap tabular-nums [&>svg]:size-3 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        accent: 'bg-accent-soft text-accent-ink',
        neutral: 'bg-surface-2 text-text-2',
        ok: 'bg-ok-soft text-ok',
        warn: 'bg-warn-soft text-warn',
        danger: 'bg-danger-soft text-danger',
      },
    },
    defaultVariants: { variant: 'accent' },
  },
)

export function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span'
  return <Comp data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
