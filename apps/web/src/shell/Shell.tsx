import { Outlet } from '@tanstack/react-router'
import { Toaster } from 'sonner'
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
      <Toaster
        position="bottom-center"
        // Above the composer and the phone tab bar, so a toast never covers what you type.
        offset={96}
        mobileOffset={136}
        toastOptions={{
          unstyled: true,
          classNames: {
            toast:
              'flex items-center gap-2 rounded-pill bg-text px-4 py-2.5 text-small text-bg shadow-2',
          },
        }}
      />
    </ShellProvider>
  )
}
