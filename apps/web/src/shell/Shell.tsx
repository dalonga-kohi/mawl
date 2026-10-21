import { Outlet } from '@tanstack/react-router'
import { Toaster } from '../ui/Toaster.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { ShellProvider } from './ShellContext.tsx'
import { Sidebar } from './Sidebar.tsx'
import { MEDIUM, useMediaQuery, WIDE } from './use-media-query.ts'

/**
 * The app frame: the sidebar on the window background (`--bg`), and the current view flat and
 * full-bleed on `--surface`, split by a 1 px line (UI-REDESIGN.md §5). Below 760 px the sidebar is a drawer.
 */
export function Shell() {
  const wide = useMediaQuery(WIDE)
  const medium = useMediaQuery(MEDIUM)
  return (
    <ShellProvider wide={wide} medium={medium}>
      <div className="flex h-dvh bg-bg text-text">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </ShellProvider>
  )
}
