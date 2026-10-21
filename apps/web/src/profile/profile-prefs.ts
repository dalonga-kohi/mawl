import { z } from 'zod'

/**
 * The owner's profile. Until U6 moves it to the server this lives in the browser; the personal
 * context is what Mawl should always know about its owner.
 */
export const PROFILE_STORAGE_KEY = 'mawl.profile'

export const NAME_MAX = 80
export const CONTEXT_MAX = 2000

export const ProfilePrefs = z.object({
  name: z.string().trim().max(NAME_MAX),
  context: z.string().max(CONTEXT_MAX),
})
export type ProfilePrefs = z.infer<typeof ProfilePrefs>

export const EMPTY_PROFILE: ProfilePrefs = Object.freeze({ name: '', context: '' })

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

/** Parses a stored value; anything unusable is an empty profile. Never throws. */
export function parseProfile(raw: string | null): ProfilePrefs {
  if (!raw) return EMPTY_PROFILE
  try {
    const parsed = ProfilePrefs.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : EMPTY_PROFILE
  } catch {
    return EMPTY_PROFILE
  }
}

export function readRawProfile(storage: ReadStorage): string | null {
  try {
    return storage?.getItem(PROFILE_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function loadProfile(storage: ReadStorage): ProfilePrefs {
  return parseProfile(readRawProfile(storage))
}

/** Trims the name and caps both fields, so a saved profile always re-parses. */
export function saveProfile(storage: WriteStorage, profile: ProfilePrefs): void {
  const clean: ProfilePrefs = {
    name: profile.name.trim().slice(0, NAME_MAX),
    context: profile.context.slice(0, CONTEXT_MAX),
  }
  try {
    storage?.setItem(PROFILE_STORAGE_KEY, JSON.stringify(clean))
  } catch {
    // Storage can be full or blocked; the profile then lasts only until the next reload.
  }
}
