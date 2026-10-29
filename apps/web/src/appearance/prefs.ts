import { DEFAULT_PALETTE_ID, isPaletteId, PALETTE_IDS, type PaletteId } from '@mawl/ui'
import { z } from 'zod'

/** `system` leaves `data-theme` off, so the `prefers-color-scheme` media query in tokens.css decides. */
export type ThemePref = 'system' | 'light' | 'dark'

export interface Appearance {
  theme: ThemePref
  /** A named palette from @mawl/ui; it sets `data-palette` on `<html>`. */
  palette: PaletteId
  /** The in-app reduced-motion toggle; the OS setting is honoured on top of it. */
  reduceMotion: boolean
}

/** Per-viewer convenience only: until settings sync from the server (P6.2) this lives in the browser. */
export const APPEARANCE_STORAGE_KEY = 'mawl.appearance'

export const DEFAULT_APPEARANCE: Appearance = Object.freeze({
  theme: 'system',
  palette: DEFAULT_PALETTE_ID,
  reduceMotion: false,
})

export const THEME_PREFS: readonly ThemePref[] = ['system', 'light', 'dark']

/**
 * The stored record is untrusted (stale versions, other tabs, hand edits). Each field falls back on
 * its own, unknown keys are dropped: a record from before U9 (`accent`, no `palette`) loads as Mawl
 * and loses its accent the next time it is saved.
 */
const StoredAppearance = z.object({
  theme: z.enum(['system', 'light', 'dark']).catch(DEFAULT_APPEARANCE.theme),
  palette: z.enum(PALETTE_IDS).catch(DEFAULT_APPEARANCE.palette),
  reduceMotion: z.boolean().catch(DEFAULT_APPEARANCE.reduceMotion),
})

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ...DEFAULT_APPEARANCE }
  const parsed = StoredAppearance.safeParse(raw)
  return parsed.success ? parsed.data : { ...DEFAULT_APPEARANCE }
}

export function saveAppearance(storage: WriteStorage, appearance: Appearance): void {
  const { theme, palette, reduceMotion } = appearance
  try {
    storage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme, palette, reduceMotion }))
  } catch {
    // Storage can be full or blocked; the choice still applies for this visit.
  }
}

/**
 * Applies theme, palette and motion to the root element. Both are attribute swaps: tokens.css holds
 * every palette, so no color is ever written inline.
 */
export function applyAppearance(root: HTMLElement, appearance: Appearance): void {
  if (appearance.theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', appearance.theme)
  root.setAttribute(
    'data-palette',
    isPaletteId(appearance.palette) ? appearance.palette : DEFAULT_PALETTE_ID,
  )
  root.classList.toggle('reduce-motion', appearance.reduceMotion)
}
