import { applyAppearance, DEFAULT_APPEARANCE } from '../appearance/prefs.ts'
import type { HostAppearance } from './remote.ts'
import type { SplashView } from './Splash.tsx'

/** `splash.html?connect` opens on the "Connect to a remote Mawl" form (the tray's menu item). */
export function initialViewFrom(search: string): SplashView {
  return new URLSearchParams(search).has('connect') ? 'connect' : 'main'
}

/**
 * The owner's theme, accent and reduced motion, as the host last read them from the app (the
 * splash cannot read the app origin's storage). Without one, the defaults stay: the OS theme and
 * Mawl's own accent.
 */
export function applySplashAppearance(root: HTMLElement, look: HostAppearance | null): void {
  if (!look) return
  applyAppearance(root, {
    theme: look.theme,
    accent: look.accent ?? DEFAULT_APPEARANCE.accent,
    reduceMotion: look.reduceMotion,
  })
}
