import { useCallback, useSyncExternalStore } from 'react'
import {
  EMPTY_PROFILE,
  type ProfilePrefs,
  parseProfile,
  readRawProfile,
  saveProfile,
} from './profile-prefs.ts'

const listeners = new Set<() => void>()
// The snapshot must be referentially stable between reads of the same stored text.
let lastRaw: string | null | undefined
let lastValue: ProfilePrefs = EMPTY_PROFILE

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  window.addEventListener('storage', onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onChange)
  }
}

function getSnapshot(): ProfilePrefs {
  const raw = readRawProfile(window.localStorage)
  if (raw !== lastRaw) {
    lastRaw = raw
    lastValue = parseProfile(raw)
  }
  return lastValue
}

/** The owner's name and personal context, kept in the browser until U6 moves them to the server. */
export function useProfile() {
  const profile = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_PROFILE)
  const save = useCallback((next: ProfilePrefs) => {
    saveProfile(window.localStorage, next)
    for (const l of listeners) l()
  }, [])
  return { profile, save }
}
