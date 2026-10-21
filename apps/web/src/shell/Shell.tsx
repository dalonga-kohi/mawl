import { Outlet } from '@tanstack/react-router'
import { Toaster } from '../ui/Toaster.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { ShellProvider } from './ShellContext.tsx'
import { Sidebar } from './Sidebar.tsx'
import { MEDIUM, useMediaQuery, WIDE } from './use-media-query.ts'

/**
 * The app frame: the sidebar on the window background, and the current view floating in a large
 * rounded panel (UI-REDESIGN.md §5). Below 760 px the panel is full-bleed and the sidebar a drawer.
 */
export function Shell() {
  const wide = useMediaQuery(WIDE)
  const medium = useMediaQuery(MEDIUM)
  return (
    <ShellProvider wide={wide} medium={medium}>
      <div className="flex h-dvh bg-bg text-text">
        <Sidebar />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col md:p-2">
          <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden bg-surface md:rounded-panel md:border md:border-line">
            <Outlet />
          </div>
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </ShellProvider>
  )
}
