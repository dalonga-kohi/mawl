import { Link } from '@tanstack/react-router'
import { PanelRight, PanelRightClose, Search } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import { overlayFade, sheetFromRight, transitions } from '../motion/presets.ts'
import { paletteShortcutLabel } from '../shell/CommandPalette.tsx'
import { useShell } from '../shell/ShellContext.tsx'
import { MEDIUM, useMediaQuery, WIDE } from '../shell/use-media-query.ts'
import { buttonClass, IconButton } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { EmptyState } from '../ui/EmptyState.tsx'
import { ContextPanelBody } from './ContextPanel.tsx'

const PANEL_WIDTH = 360

function TeammateList() {
  const { setPaletteOpen } = useShell()
  return (
    <aside
      aria-label="Teammates"
      className="hidden min-w-0 flex-col border-r border-line bg-surface-2 md:flex"
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-[18px] pb-2.5">
        <h1 className="text-heading">Teammates</h1>
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-2.5 flex h-[38px] items-center gap-2 rounded-sm bg-surface px-2.5 text-left text-small text-text-3 transition-colors duration-[120ms] hover:text-text-2"
      >
        <Search className="size-[18px]" aria-hidden="true" />
        <span className="flex-1">Search or jump to…</span>
        <kbd className="rounded-xs bg-surface-2 px-1.5 font-ui text-micro text-text-2">
          {paletteShortcutLabel()}
        </kbd>
      </button>
      <p className="px-4 py-3 text-small text-text-2">Your teammates will be listed here.</p>
    </aside>
  )
}

function Conversation({ showTitle }: { showTitle: boolean }) {
  const { panelOpen, setPanelOpen } = useShell()
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-bg">
      <header className="flex min-h-[68px] items-center justify-end gap-3 border-b border-line px-5 py-3.5">
        {/* Below 760 px the list is hidden, so the conversation carries the view's title. */}
        {showTitle ? <h1 className="flex-1 text-heading">Teammates</h1> : null}
        <IconButton
          label={panelOpen ? 'Hide side panel' : 'Show side panel'}
          onClick={() => setPanelOpen(!panelOpen)}
          aria-expanded={panelOpen}
        >
          {panelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRight aria-hidden="true" />}
        </IconButton>
      </header>
      <EmptyState
        title="No teammates yet"
        mascot="idle"
        mascotSize={120}
        action={
          <Link to="/settings" hash="models" className={buttonClass('primary')}>
            Connect a model
          </Link>
        }
      >
        Connect a model first. Then create a teammate and give it a job in one sentence.
      </EmptyState>
    </section>
  )
}

function InlinePanel() {
  const { panelOpen } = useShell()
  return (
    <AnimatePresence initial={false}>
      {panelOpen ? (
        <motion.aside
          key="panel"
          aria-label="Context"
          className="flex min-w-0 flex-col overflow-hidden border-l border-line bg-surface"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: PANEL_WIDTH, opacity: 1, transition: transitions.gentle }}
          exit={{ width: 0, opacity: 0, transition: transitions.exit }}
        >
          <div className="flex min-h-0 flex-1 flex-col" style={{ width: PANEL_WIDTH }}>
            <ContextPanelBody />
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

function SheetPanel() {
  const { panelOpen, setPanelOpen } = useShell()
  return (
    <Dialog.Root open={panelOpen} onOpenChange={setPanelOpen}>
      <AnimatePresence>
        {panelOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-text/20" {...overlayFade} />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className="fixed inset-y-0 right-0 z-50 flex w-[min(360px,100vw)] flex-col rounded-l-lg bg-surface shadow-2"
                {...sheetFromRight}
              >
                <Dialog.Title className="sr-only">Context</Dialog.Title>
                <ContextPanelBody />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}

/**
 * Teammate list, conversation and context panel. Below 1100 px the panel becomes a sheet; below
 * 760 px the list steps aside and the conversation takes the screen (DESIGN.md §5).
 */
export function TeammatesView() {
  const wide = useMediaQuery(WIDE)
  const medium = useMediaQuery(MEDIUM)
  return (
    <div
      className={cx(
        'grid min-h-0 flex-1',
        medium ? 'grid-cols-[280px_minmax(0,1fr)_auto]' : 'grid-cols-[minmax(0,1fr)]',
      )}
    >
      <TeammateList />
      <Conversation showTitle={!medium} />
      {wide ? <InlinePanel /> : <SheetPanel />}
    </div>
  )
}
