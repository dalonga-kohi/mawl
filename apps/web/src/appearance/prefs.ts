import { applyAccent, defaultAccent, deriveAccent } from '@mawl/ui'

/** `system` leaves `data-theme` off, so the `prefers-color-scheme` media query in tokens.css decides. */
export type ThemePref = 'system' | 'light' | 'dark'

export interface Appearance {
  theme: ThemePref
  /** `#RRGGBB`; any color the accent engine accepts. */
  accent: string
  /** The in-app reduced-motion toggle; the OS setting is honoured on top of it. */
  reduceMotion: boolean
}

/** Per-viewer convenience only: until settings sync from the server (P6.2) this lives in the browser. */
export const APPEARANCE_STORAGE_KEY = 'mawl.appearance'

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  theme: 'system',
  accent: defaultAccent.hex,
  reduceMotion: false,
})

export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark']

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

export function isAccentHex(value: unknown): value is string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) return false
  try {
    deriveAccent(value, 'light')
    return true
  } catch {
    return false
  }
}

const isThemePref = (value: unknown): value is ThemePref =>
  typeof value === 'string' && (THEME_PREFS as readonly string[]).includes(value)

function readRaw(storage: ReadStorage): unknown {
  try {
    const raw = storage?.getItem(APPEARANCE_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** Never throws: private windows, blocked storage and stale or hand-edited values all fall back. */
export function loadAppearance(storage: ReadStorage): Appearance {
  const raw = readRaw(storage)
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_APPEARANCE }
  const value = raw as Record<string, unknown>
  return {
    theme: isThemePref(value.theme) ? value.theme : DEFAULT_APPEARANCE.theme,
    accent: isAccentHex(value.accent) ? value.accent.toUpperCase() : DEFAULT_APPEARANCE.accent,
    reduceMotion:
      typeof value.reduceMotion === 'boolean'
        ? value.reduceMotion
        : DEFAULT_APPEARANCE.reduceMotion,
  }
}

export function saveAppearance(storage: WriteStorage, appearance: Appearance): void {
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(appearance))
  } catch {
    // Storage can be full or blocked; the choice still applies for this visit.
  }
}

/** Applies theme, accent and motion to the root element. Accent changes are a CSS-variable swap. */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  if (appearance.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance.theme)
  applyAccent(
    isAccentHex(appearance.accent) ? appearance.accent : DEFAULT_APPEARANCE.accent,
    root.style,
  )
  root.classList.toggle('reduce-motion', appearance.reduceMotion)
}
