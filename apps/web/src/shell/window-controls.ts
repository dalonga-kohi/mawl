import { inTauri } from '../splash/bridge.ts'

export interface WindowWatch {
  onMaximized(maximized: boolean): void
  onFocus(focused: boolean): void
}

/** The desktop window, as the title bar needs it. */
export interface WindowControls {
  minimize(): Promise<void>
  toggleMaximize(): Promise<void>
  close(): Promise<void>
  /** Reports the current state at once, then every change. Resolves to the stop function. */
  watch(handlers: WindowWatch): Promise<() => void>
}

// Loaded on first use so the browser build never pulls the Tauri window API in.
const current = () => import('@tauri-apps/api/window').then((m) => m.getCurrentWindow())

/** The Tauri window, or `null` in a browser or headless build, where there is no title bar. */
export function hostWindowControls(): WindowControls | null {
  if (!inTauri(window)) return null
  return {
    minimize: async () => (await current()).minimize(),
    toggleMaximize: async () => (await current()).toggleMaximize(),
    close: async () => (await current()).close(),
    watch: async ({ onMaximized, onFocus }) => {
      const w = await current()
      const refresh = () => void w.isMaximized().then(onMaximized, () => {})
      refresh()
      void w.isFocused().then(onFocus, () => {})
      const offResize = await w.onResized(refresh)
      const offFocus = await w.onFocusChanged((e) => onFocus(e.payload))
      return () => {
        offResize()
        offFocus()
      }
    },
  }
}
