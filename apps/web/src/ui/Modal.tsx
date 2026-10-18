import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { overlayFade, transitions } from '../motion/presets.ts'
import { IconButton } from './Button.tsx'

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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-text/20" {...overlayFade} />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
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
              <motion.div
                className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-32px)] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-lg bg-surface p-5 shadow-2"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1, transition: transitions.gentle }}
                exit={{ opacity: 0, scale: 0.98, transition: transitions.exit }}
              >
                <div className="flex items-center justify-between gap-2">
                  <Dialog.Title className="text-heading">{title}</Dialog.Title>
                  <Dialog.Close asChild>
                    <IconButton label="Close">
                      <X aria-hidden="true" />
                    </IconButton>
                  </Dialog.Close>
                </div>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}

/** The text field look shared by forms (DESIGN.md: inputs use --r-sm and a ring on focus). */
export const fieldClass =
  'w-full rounded-sm bg-surface px-3.5 text-body text-text shadow-[0_0_0_1px_var(--line)] outline-none transition-shadow duration-[120ms] placeholder:text-text-3 focus:shadow-[0_0_0_2px_var(--accent-ring)] aria-[invalid=true]:shadow-[0_0_0_2px_var(--danger)]'
