import type { ReactNode } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './Dialog.tsx'

export { fieldClass } from './Input.tsx'

/** A centered dialog with a title row and a close button; focus starts on the first field. */
export function Modal({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          // Start on the first field, not the Close button.
          const first = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            'input, select, textarea',
          )
          if (first) {
            e.preventDefault()
            first.focus()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}
