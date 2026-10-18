import { MotionConfig } from 'motion/react'
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react'
import {
  type Appearance,
  applyAppearance,
  isAccentHex,
  loadAppearance,
  saveAppearance,
  type ThemePref,
} from './prefs.ts'

interface AppearanceApi {
  appearance: Appearance
  setTheme(theme: ThemePref): void
  setAccent(hex: string): void
  setReduceMotion(on: boolean): void
}

const AppearanceContext = createContext<AppearanceApi | null>(null)

function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Owns theme, accent and motion for the whole app and mirrors them onto `<html>`. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    const initial = loadAppearance(safeStorage())
    applyAppearance(document.documentElement, initial)
    return initial
  })

  const update = useCallback((patch: Partial<Appearance>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...patch }
      applyAppearance(document.documentElement, next)
      saveAppearance(safeStorage(), next)
      return next
    })
  }, [])

  const api = useMemo<AppearanceApi>(
    () => ({
      appearance,
      setTheme: (theme) => update({ theme }),
      setAccent: (hex) => {
        if (isAccentHex(hex)) update({ accent: hex.toUpperCase() })
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
