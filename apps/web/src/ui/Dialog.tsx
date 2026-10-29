import { X } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import type { ComponentProps } from 'react'
import { IconButton } from './Button.tsx'
import { cn } from './cn.ts'

/**
 * shadcn's dialog, reshaped for Mawl: a 32 px-radius surface over a soft wash of the background,
 * a hairline instead of a shadow in dark mode (via --shadow-2), and a gentle fade and settle that
 * exits faster than it enters. Reduced motion turns the animation into an instant change.
 */
export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogPortal = DialogPrimitive.Portal
export const DialogClose = DialogPrimitive.Close

/** Fade timing shared by the overlay and every dialog-like surface (sheet, alert dialog). */
export const overlayClass = cn(
  'fixed inset-x-0 top-(--titlebar-h) bottom-0 z-40 bg-bg/70 backdrop-blur-[2px]',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-(--dur-base)',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-(--dur-fast)',
)

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(overlayClass, className)}
      {...props}
    />
  )
}

/** The centered surface; callers lay out its inside. Pair it with a DialogTitle. */
export const dialogSurfaceClass = cn(
  'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto',
  'rounded-dialog bg-surface p-6 text-text shadow-2 outline-none',
  'ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[.98] data-[state=open]:duration-(--dur-base)',
  'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[.98] data-[state=closed]:duration-(--dur-fast)',
)

export function DialogContent({
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogSurfaceClass, className)}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

/** Title on the left, a round Close button on the right. */
export function DialogHeader({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<'div'> & { showClose?: boolean }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('-mt-1 -mr-2 flex items-center justify-between gap-2', className)}
      {...props}
    >
      {children}
      {showClose ? (
        <DialogClose asChild>
          <IconButton label="Close">
            <X aria-hidden="true" />
          </IconButton>
        </DialogClose>
      ) : null}
    </div>
  )
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-wrap justify-end gap-2 pt-1', className)}
      {...props}
    />
  )
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-heading', className)}
      {...props}
    />
  )
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-small text-text-2', className)}
      {...props}
    />
  )
}
