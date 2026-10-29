import { useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, ArrowRight, PanelLeft, Search } from 'lucide-react'
import type { ComponentProps } from 'react'
import { MawlAvatar } from '../mascot/MawlAvatar.tsx'
import { useProfiles } from '../teammates/queries.ts'
import { cn } from '../ui/cn.ts'
import { paletteShortcutLabel } from './CommandPalette.tsx'
import { useShell } from './ShellContext.tsx'
import { sidebarShortcutLabel } from './shortcuts.ts'
import { TitleBar } from './TitleBar.tsx'
import type { WindowControls } from './window-controls.ts'

const BAR_BUTTON = cn(
  'tween grid size-8 shrink-0 place-items-center rounded-sm text-text-2',
  'hover:bg-hover hover:text-text active:scale-[.97] active:bg-selected',
  'disabled:pointer-events-none disabled:opacity-40',
  '[&>svg]:size-4',
)

function BarButton({ className, ...rest }: ComponentProps<'button'>) {
  return <button type="button" className={cn(BAR_BUTTON, className)} {...rest} />
}

/** The open teammate's orb and name, from the address (`/t/<slug>`). Nothing elsewhere. */
function CurrentTeammate() {
  const slug = useParams({ strict: false }).slug
  const { mascot } = useShell()
  const profile = useProfiles().data?.find((p) => p.slug === slug)
  if (!slug || !profile) return null
  return (
    <div
      data-tauri-drag-region
      className="pointer-events-none ml-1 flex min-w-0 items-center gap-2"
    >
      <MawlAvatar color={profile.color} size={20} state={mascot} />
      <span className="truncate text-small font-semibold text-text">{profile.name}</span>
    </div>
  )
}

/**
 * The desktop window's title bar with the app's own controls: the sidebar toggle, back and forward,
 * Search (opens the palette) and the teammate whose conversation is open.
 */
export function AppTitleBar({ controls }: { controls: WindowControls }) {
  const { toggleSidebar, openPaletteFrom } = useShell()
  const { history } = useRouter()
  // Subscribes to navigation so Back follows the history as it grows.
  useRouterState({ select: (s) => s.location.href })
  return (
    <TitleBar controls={controls}>
      <BarButton
        aria-label="Toggle sidebar"
        title={`Sidebar (${sidebarShortcutLabel()})`}
        onClick={toggleSidebar}
      >
        <PanelLeft aria-hidden="true" />
      </BarButton>
      <BarButton aria-label="Back" disabled={!history.canGoBack()} onClick={() => history.back()}>
        <ArrowLeft aria-hidden="true" />
      </BarButton>
      <BarButton aria-label="Forward" onClick={() => history.forward()}>
        <ArrowRight aria-hidden="true" />
      </BarButton>
      <CurrentTeammate />
      <button
        type="button"
        aria-label="Search"
        onClick={(e) => openPaletteFrom(e.currentTarget)}
        className={cn(
          'tween ml-auto flex h-7 w-56 min-w-0 shrink items-center gap-2 rounded-sm bg-hover px-2.5 text-small text-text-3',
          'hover:bg-selected hover:text-text-2 active:scale-[.97] max-[600px]:w-8 max-[600px]:justify-center max-[600px]:px-0',
        )}
      >
        <Search aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="flex-1 truncate text-left max-[600px]:hidden">Search</span>
        <kbd className="font-ui text-micro max-[600px]:hidden">{paletteShortcutLabel()}</kbd>
      </button>
    </TitleBar>
  )
}
