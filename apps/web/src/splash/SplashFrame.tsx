import type { ReactNode } from 'react'
import { TitleBar } from '../shell/TitleBar.tsx'
import type { WindowControls } from '../shell/window-controls.ts'

/**
 * The splash's frame: the window's title bar (window buttons only; the app's own items need the
 * app) above the page. The window has no native bar, so the splash needs ours too.
 */
export function SplashFrame({
  controls,
  children,
}: {
  controls: WindowControls | null
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      {controls ? <TitleBar controls={controls} /> : null}
      {children}
    </div>
  )
}
