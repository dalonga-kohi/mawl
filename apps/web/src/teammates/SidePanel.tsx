import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import type { ReactNode } from 'react'
import { overlayFade, sheetFromRight, transitions } from '../motion/presets.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { useMediaQuery, WIDE } from '../shell/use-media-query.ts'

const PANEL_WIDTH = 360

function InlinePanel({ children }: { children: ReactNode }) {
  const { panelOpen } = useShell()
  return (
    <AnimatePresence initial={false}>
      {panelOpen ? (
        <motion.aside
          key="panel"
          aria-label="Context"
          className="flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-line bg-bg"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: PANEL_WIDTH, opacity: 1, transition: transitions.gentle }}
          exit={{ width: 0, opacity: 0, transition: transitions.exit }}
        >
          <div className="flex min-h-0 flex-1 flex-col" style={{ width: PANEL_WIDTH }}>
            {children}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

function SheetPanel({ children }: { children: ReactNode }) {
  const { panelOpen, setPanelOpen } = useShell()
  return (
    <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
      <AnimatePresence>
        {panelOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-0 z-40 bg-bg/70 backdrop-blur-[2px]"
                {...overlayFade}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-50 flex w-[min(360px,100vw)] flex-col rounded-l-lg bg-surface shadow-2"
                {...sheetFromRight}
              >
                <Dialog.Title className="sr-only">Context</Dialog.Title>
                {children}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}

/** The context panel: inline from 1100 px, a sheet from the right below (DESIGN.md §5). */
export function SidePanel({ children }: { children: ReactNode }) {
  const wide = useMediaQuery(WIDE)
  return wide ? <InlinePanel>{children}</InlinePanel> : <SheetPanel>{children}</SheetPanel>
}
