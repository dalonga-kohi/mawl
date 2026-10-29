import { applyAppearance, DEFAULT_APPEARANCE } from '../appearance/prefs.ts'
import type { HostAppearance } from './remote.ts'
import type { SplashView } from './Splash.tsx'

/** `splash.html?connect` opens on the "Connect to a remote Mawl" form (the tray's menu item). */
export function initialViewFrom(search: string): SplashView {
  return new URLSearchParams(search).has('connect') ? 'connect' : 'main'
}

/**
 * The owner's theme and reduced motion, as the host last read them from the app (the splash cannot
 * read the app origin's storage). The host still reports the retired `accent` and not the palette
 * (U14 carries it over), so the splash wears Mawl. Without a saved appearance the defaults stay.
 */
export function applySplashAppearance(root: HTMLElement, look: HostAppearance | null): void {
  if (!look) return
  applyAppearance(root, {
    theme: look.theme,
    palette: DEFAULT_APPEARANCE.palette,
    reduceMotion: look.reduceMotion,
  })
}
