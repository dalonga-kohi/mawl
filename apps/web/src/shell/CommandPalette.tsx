import { paletteList } from '@mawl/ui'
import { useNavigate } from '@tanstack/react-router'
import { Command } from 'cmdk'
import { Laptop, Monitor, Moon, PanelLeft, Search, Sun, Wind } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Dialog } from 'radix-ui'
import { type ReactNode, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppearance } from '../appearance/AppearanceProvider.tsx'
import { overlayFade, transitions } from '../motion/presets.ts'
import { ALL_NAV } from './nav.ts'
import { useShell } from './ShellContext.tsx'
import { sidebarShortcutLabel } from './shortcuts.ts'

/** "⌘K" on Apple platforms, "Ctrl K" elsewhere; both shortcuts work everywhere. */
export const paletteShortcutLabel = () =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘K' : 'Ctrl K'

/** The palette's box: 560 px wide (16 px margins on phones), centered, 14vh from the top. */
const PALETTE_MAX = 560
/**
 * Where the palette grows from: the control that opened it (the sidebar's Search row), expressed
 * in the palette's own box; opened by key it grows from its top center.
 */
export function paletteTransformOrigin(
  origin: { x: number; y: number } | null,
  viewport = { width: window.innerWidth, height: window.innerHeight },
): string {
  if (!origin) return '50% 0%'
  const width = Math.min(PALETTE_MAX, viewport.width - 32)
  const left = (viewport.width - width) / 2
  const top = viewport.height * 0.14
  return `${Math.round(origin.x - left)}px ${Math.round(origin.y - top)}px`
}

const isPaletteShortcut = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k'

function Item({
  children,
  onSelect,
  keywords,
  icon,
  hint,
}: {
  children: string
  onSelect: () => void
  keywords?: string[]
  icon: ReactNode
  hint?: string
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      keywords={keywords ?? []}
      className="tween flex h-10 cursor-pointer items-center gap-3 rounded-md px-3.5 text-body text-text select-none pointer-coarse:h-11 data-[selected=true]:bg-selected [&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-text-2 data-[selected=true]:[&_svg]:text-accent-ink"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <kbd className="shrink-0 font-ui text-micro text-text-3">{hint}</kbd> : null}
    </Command.Item>
  )
}

const groupClass =
  'pb-1 [&_[cmdk-group-heading]]:px-3.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-small [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-text-2'
/** ⌘K / Ctrl+K: jump to a view or change appearance without leaving the keyboard. */
export function CommandPalette() {
  const {
    paletteOpen,
    setPaletteOpen,
    paletteOrigin,
    panelOpen,
    setPanelOpen,
    sidebarVisible,
    toggleSidebar,
  } = useShell()
  const { appearance, setTheme, setPalette, setReduceMotion } = useAppearance()
  const navigate = useNavigate()

  // Every opening starts from an empty search. Reset during render (not in an effect) so the first
  // frame is already clean, and only on opening, so the list does not jump while it fades out.
  const [query, setQuery] = useState('')
  const [wasOpen, setWasOpen] = useState(paletteOpen)
  if (paletteOpen !== wasOpen) {
    setWasOpen(paletteOpen)
    if (paletteOpen) setQuery('')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isPaletteShortcut(e)) return
      e.preventDefault()
      setPaletteOpen(!paletteOpen)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen, setPaletteOpen])

  const run = (action: () => void, message?: string) => () => {
    setPaletteOpen(false)
    action()
    if (message) toast(message)
  }

  return (
    <Dialog.Root open={paletteOpen} onOpenChange={setPaletteOpen}>
      <AnimatePresence>
        {paletteOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-x-0 top-(--titlebar-h) bottom-0 z-40 bg-bg/70 backdrop-blur-[2px]"
                {...overlayFade}
              />
            </Dialog.Overlay>
            <Dialog.Content asChild aria-describedby={undefined}>
              <motion.div
                className="fixed top-[14vh] left-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-panel bg-surface p-2 shadow-2"
                style={{ transformOrigin: paletteTransformOrigin(paletteOrigin) }}
                initial={{ opacity: 0, scale: 0.96, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0, transition: transitions.glide }}
                exit={{ opacity: 0, scale: 0.96, transition: transitions.exit }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                <Command label="Command palette" loop>
                  <div className="flex items-center gap-3 rounded-card bg-surface-2 px-4">
                    <Search className="size-[18px] shrink-0 text-text-3" aria-hidden="true" />
                    <Command.Input
                      value={query}
                      onValueChange={setQuery}
                      aria-label="Search commands"
                      placeholder="Search or jump to…"
                      className="h-11 flex-1 rounded-card bg-transparent text-body text-text outline-none placeholder:text-text-3 pointer-coarse:h-12"
                    />
                  </div>
                  <Command.List className="max-h-[min(420px,60vh)] overflow-y-auto overscroll-contain pt-1">
                    <Command.Empty className="px-4 py-10 text-center text-small text-text-2">
                      Nothing found
                    </Command.Empty>
                    <Command.Group heading="Go to" className={groupClass}>
                      {ALL_NAV.map((item) => {
                        const Icon = item.icon
                        return (
                          <Item
                            key={item.to}
                            keywords={item.keywords}
                            icon={<Icon aria-hidden="true" />}
                            onSelect={run(() => navigate({ to: item.to }))}
                          >
                            {item.label}
                          </Item>
                        )
                      })}
                    </Command.Group>
                    <Command.Group heading="Appearance" className={groupClass}>
                      <Item
                        keywords={['auto', 'os', 'mode']}
                        icon={<Laptop aria-hidden="true" />}
                        onSelect={run(() => setTheme('system'), 'Theme follows your system')}
                      >
                        System theme
                      </Item>
                      <Item
                        keywords={['mode', 'day']}
                        icon={<Sun aria-hidden="true" />}
                        onSelect={run(() => setTheme('light'), 'Light theme on')}
                      >
                        Light theme
                      </Item>
                      <Item
                        keywords={['mode', 'night']}
                        icon={<Moon aria-hidden="true" />}
                        onSelect={run(() => setTheme('dark'), 'Dark theme on')}
                      >
                        Dark theme
                      </Item>
                      {paletteList.map((p) => (
                        <Item
                          key={p.id}
                          keywords={['palette', 'colors', 'colours', 'scheme', p.id]}
                          icon={
                            <span
                              aria-hidden="true"
                              data-palette={p.id}
                              data-theme={
                                appearance.theme === 'system' ? undefined : appearance.theme
                              }
                              className="size-[18px] shrink-0 rounded-full bg-accent-fill shadow-[0_0_0_2px_var(--surface-2)]"
                            />
                          }
                          onSelect={run(() => setPalette(p.id), `Palette set to ${p.name}`)}
                        >
                          {`Palette: ${p.name}`}
                        </Item>
                      ))}
                      <Item
                        keywords={['animation', 'motion', 'accessibility']}
                        icon={<Wind aria-hidden="true" />}
                        onSelect={run(
                          () => setReduceMotion(!appearance.reduceMotion),
                          appearance.reduceMotion ? 'Motion restored' : 'Motion reduced',
                        )}
                      >
                        {appearance.reduceMotion ? 'Restore motion' : 'Reduce motion'}
                      </Item>
                    </Command.Group>
                    <Command.Group heading="Layout" className={groupClass}>
                      <Item
                        keywords={['navigation', 'menu', 'teammates']}
                        icon={<PanelLeft aria-hidden="true" />}
                        hint={sidebarShortcutLabel()}
                        onSelect={run(toggleSidebar)}
                      >
                        {sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
                      </Item>{' '}
                      <Item
                        keywords={['context', 'computer', 'panel', 'sidebar']}
                        icon={<Monitor aria-hidden="true" />}
                        onSelect={run(() => setPanelOpen(!panelOpen))}
                      >
                        {panelOpen ? 'Hide computer panel' : 'Show computer panel'}
                      </Item>
                    </Command.Group>
                  </Command.List>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}
