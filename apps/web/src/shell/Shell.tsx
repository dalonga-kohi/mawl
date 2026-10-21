import { Outlet } from '@tanstack/react-router'
import { Toaster } from '../ui/Toaster.tsx'
import { CommandPalette } from './CommandPalette.tsx'
import { Rail } from './Rail.tsx'
import { ShellProvider } from './ShellContext.tsx'
import { useMediaQuery, WIDE } from './use-media-query.ts'

/** The app frame: rail plus the current view, filling the viewport. */
export function Shell() {
  const wide = useMediaQuery(WIDE)
  return (
    <ShellProvider wide={wide}>
      <div className="flex h-dvh flex-col bg-bg text-text md:flex-row">
        <Rail />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
      <CommandPalette />
      <Toaster />
    </ShellProvider>
  )
}
