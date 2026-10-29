import { dur, isPaletteId, type PaletteId } from '@mawl/ui'
import { MotionConfig } from 'motion/react'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  type Appearance,
  applyAppearance,
  loadAppearance,
  saveAppearance,
  type ThemePref,
} from './prefs.ts'

interface AppearanceApi {
  appearance: Appearance
  setTheme(theme: ThemePref): void
  setPalette(palette: PaletteId): void
  setReduceMotion(on: boolean): void
}

/**
 * How long `<html>` keeps the `color-swap` class after a palette or theme change. styles.css tweens
 * background, text and border colors over `--dur-base` while it is on; the margin lets the tween
 * finish before the class goes.
 */
export const COLOR_SWAP_MS = dur.base + 50

const AppearanceContext = createContext<AppearanceApi | null>(null)

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Owns theme, palette and motion for the whole app and mirrors them onto `<html>`. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => loadAppearance(safeStorage()))
  const shown = useRef<Pick<Appearance, 'theme' | 'palette'> | null>(null)
  const swapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Layout effect: the new colors land before paint, so there is no flash of the old ones.
  // Updaters stay pure; Strict Mode may call them twice.
  useLayoutEffect(() => {
    const root = document.documentElement
    const prev = shown.current
    // The first paint never tweens; later palette or theme changes cross-fade their colors.
    if (prev && (prev.theme !== appearance.theme || prev.palette !== appearance.palette)) {
      root.classList.add('color-swap')
      clearTimeout(swapTimer.current)
      swapTimer.current = setTimeout(() => root.classList.remove('color-swap'), COLOR_SWAP_MS)
    }
    shown.current = { theme: appearance.theme, palette: appearance.palette }
    applyAppearance(root, appearance)
    saveAppearance(safeStorage(), appearance)
  }, [appearance])

  useEffect(
    () => () => {
      clearTimeout(swapTimer.current)
      document.documentElement.classList.remove('color-swap')
    },
    [],
  )

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((prev) => ({ ...prev, ...patch }))
  }, [])

  const api = useMemo<AppearanceApi>(
    () => ({
      appearance,
      setTheme: (theme) => update({ theme }),
      setPalette: (palette) => {
        if (isPaletteId(palette)) update({ palette })
      },
      setReduceMotion: (reduceMotion) => update({ reduceMotion }),
    }),
    [appearance, update],
  )

  return (
    <AppearanceContext value={api}>
      {/* "user" follows the OS setting; the in-app toggle forces reduced motion on top of it. */}
      <MotionConfig reducedMotion={appearance.reduceMotion ? 'always' : 'user'}>
        {children}
      </MotionConfig>
    </AppearanceContext>
  )
}

export function useAppearance(): AppearanceApi {
  const api = useContext(AppearanceContext)
  if (!api) throw new Error('useAppearance must be used inside <AppearanceProvider>')
  return api
}
