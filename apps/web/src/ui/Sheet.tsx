import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { Dialog as SheetPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { IconButton } from './Button.tsx'
import { cn } from './cn.ts'
import { overlayClass } from './Dialog.tsx'

/**
 * shadcn's sheet: a dialog that slides from an edge. The edge it leaves rounds to --r-panel (28),
 * bottom sheets (phones) round their top corners to --r-dialog (32), the mobile sheet radius.
 */
export const Sheet = SheetPrimitive.Root
export const SheetTrigger = SheetPrimitive.Trigger
export const SheetClose = SheetPrimitive.Close

const sheetVariants = cva(
  [
    'fixed z-50 flex flex-col gap-4 bg-surface p-5 text-text shadow-2 outline-none ease-out',
    'data-[state=open]:animate-in data-[state=open]:duration-(--dur-slow)',
    'data-[state=closed]:animate-out data-[state=closed]:duration-(--dur-base)',
  ],
  {
    variants: {
      side: {
        right:
          'inset-y-2 right-2 w-[min(360px,calc(100vw-16px))] rounded-panel data-[state=open]:slide-in-from-right data-[state=closed]:slide-out-to-right',
        left: 'inset-y-2 left-2 w-[min(320px,calc(100vw-16px))] rounded-panel data-[state=open]:slide-in-from-left data-[state=closed]:slide-out-to-left',
        bottom:
          'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-dialog pb-[max(20px,env(safe-area-inset-bottom))] data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
      },
    },
    defaultVariants: { side: 'right' },
  },
)

export function SheetContent({
  className,
  children,
  side,
  ...props
}: ComponentProps<typeof SheetPrimitive.Content> & VariantProps<typeof sheetVariants>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay data-slot="sheet-overlay" className={overlayClass} />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  )
}

export function SheetHeader({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<'div'> & { showClose?: boolean }) {
  return (
    <div
      data-slot="sheet-header"
      className={cn('flex items-center justify-between gap-2', className)}
      {...props}
    >
      {children}
      {showClose ? (
        <SheetClose asChild>
          <IconButton label="Close">
            <X aria-hidden="true" />
          </IconButton>
        </SheetClose>
      ) : null}
    </div>
  )
}

export function SheetTitle({ className, ...props }: ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn('text-heading', className)}
      {...props}
    />
  )
}

export function SheetDescription({
  className,
  ...props
}: ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn('text-small text-text-2', className)}
      {...props}
    />
  )
}
