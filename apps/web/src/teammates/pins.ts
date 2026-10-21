import { useCallback, useSyncExternalStore } from 'react'
import { z } from 'zod'

/** Per-viewer convenience: which teammates float into the sidebar's Pinned group. */
export const PINNED_STORAGE_KEY = 'mawl.pinned'

const PinnedIds = z.array(z.string().min(1)).max(200)

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

function parse(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = PinnedIds.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function readRaw(storage: ReadStorage): string | null {
  try {
    return storage?.getItem(PINNED_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export const loadPinned = (storage: ReadStorage): string[] => parse(readRaw(storage))

export function savePinned(storage: WriteStorage, ids: string[]): void {
  try {
    storage?.setItem(PINNED_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // Storage can be full or blocked; the pin is not remembered.
  }
}

/** Pins `id` at the end, or unpins it when already pinned. */
export const togglePinned = (ids: string[], id: string): string[] =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]

const listeners = new Set<() => void>()
let lastRaw: string | null | undefined
let lastValue: string[] = []

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getSnapshot(): string[] {
  const raw = readRaw(window.localStorage)
  if (raw !== lastRaw) {
    lastRaw = raw
    lastValue = parse(raw)
  }
  return lastValue
}

const NONE: string[] = []

/** Pinned teammate ids, shared by every component that reads them. */
export function usePinned() {
  const pinned = useSyncExternalStore(subscribe, getSnapshot, () => NONE)
  const toggle = useCallback((id: string) => {
    savePinned(window.localStorage, togglePinned(getSnapshot(), id))
    for (const l of listeners) l()
  }, [])
  return { pinned, toggle }
}
