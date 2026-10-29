import { Outlet } from '@tanstack/react-router'
import { useMemo } from 'react'
import { Toaster } from '../ui/Toaster.tsx'
import { AppTitleBar } from './AppTitleBar.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { ShellProvider } from './ShellContext.tsx'
import { Sidebar } from './Sidebar.tsx'
import { MEDIUM, useMediaQuery, WIDE } from './use-media-query.ts'
import { hostWindowControls } from './window-controls.ts'

/**
 * The app frame: one tone. The sidebar, the current view and the workspace panel all sit on the
 * window background (`--bg`), split only by faint 1 px lines; `--surface` is for raised things
 * (composer, cards, popovers). See UI-REDESIGN.md §5. Below 760 px the sidebar is a drawer.
 */
export function Shell() {
  const wide = useMediaQuery(WIDE)
  const medium = useMediaQuery(MEDIUM)
  // Only inside the desktop app; null in a browser or headless build, so no bar and no height.
  const controls = useMemo(hostWindowControls, [])
  return (
    <ShellProvider wide={wide} medium={medium}>
      <div className="flex h-dvh flex-col bg-bg text-text">
        {controls ? <AppTitleBar controls={controls} /> : null}
        <div className="flex min-h-0 flex-1">
          <Sidebar />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      <CommandPalette />
      <Toaster />
    </ShellProvider>
  )
}
