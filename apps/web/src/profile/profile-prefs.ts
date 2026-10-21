import { USER_CONTEXT_MAX, USER_NAME_MAX, type UserProfile } from '@mawl/contracts'
import { z } from 'zod'

/**
 * The owner's profile lives on the server (`user.get` / `user.update`). This browser keeps a copy
 * only so the first paint (greeting, sidebar footer) shows the name before the server answers.
 * Before U6 that copy was the only one, so an old browser may hold a profile the server never saw:
 * useProfile moves it up once and then sets {@link PROFILE_MIGRATED_KEY}.
 */
export const PROFILE_STORAGE_KEY = 'mawl.profile'
/** Set once this browser's copy has been reconciled with the server; it is never pushed again. */
export const PROFILE_MIGRATED_KEY = 'mawl.profile.migrated'

export const NAME_MAX = USER_NAME_MAX
export const CONTEXT_MAX = USER_CONTEXT_MAX

/** The stored shape, unchanged since the browser-only profile so old copies still parse. */
const StoredProfile = z.object({
  name: z.string().trim().max(NAME_MAX),
  context: z.string().max(CONTEXT_MAX),
})

export const EMPTY_PROFILE: UserProfile = Object.freeze({ name: '', personalContext: '' })

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

export const isEmptyProfile = (p: UserProfile) => p.name === '' && p.personalContext === ''

/** Parses a stored value; anything unusable is an empty profile. Never throws. */
export function parseProfile(raw: string | null): UserProfile {
  if (!raw) return EMPTY_PROFILE
  try {
    const parsed = StoredProfile.safeParse(JSON.parse(raw))
    return parsed.success
      ? { name: parsed.data.name, personalContext: parsed.data.context }
      : EMPTY_PROFILE
  } catch {
    return EMPTY_PROFILE
  }
}

function read(storage: ReadStorage, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: WriteStorage, key: string, value: string): void {
  try {
    storage?.setItem(key, value)
  } catch {
    // Storage can be full or blocked; the copy is only a first-paint cache.
  }
}

export function loadProfile(storage: ReadStorage): UserProfile {
  return parseProfile(read(storage, PROFILE_STORAGE_KEY))
}

/** Trims the name and caps both fields, so a saved copy always re-parses. */
export function saveProfile(storage: WriteStorage, profile: UserProfile): void {
  const clean = {
    name: profile.name.trim().slice(0, NAME_MAX),
    context: profile.personalContext.slice(0, CONTEXT_MAX),
  }
  write(storage, PROFILE_STORAGE_KEY, JSON.stringify(clean))
}

export function isMigrated(storage: ReadStorage): boolean {
  return read(storage, PROFILE_MIGRATED_KEY) === '1'
}

export function markMigrated(storage: WriteStorage): void {
  write(storage, PROFILE_MIGRATED_KEY, '1')
}
