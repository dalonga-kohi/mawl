import type { UserProfile } from '@mawl/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { useApi } from '../api/ApiProvider.tsx'
import type { UserApi } from '../api/chat-api.ts'
import { keys } from '../api/keys.ts'
import {
  isEmptyProfile,
  isMigrated,
  loadProfile,
  markMigrated,
  saveProfile,
} from './profile-prefs.ts'

const storage = (): Storage | null => {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const SAVE_FAILED = "Couldn't save your profile. Check that the Mawl server is running."

/**
 * Reads the server profile. The first successful read also settles the one-time move of a
 * browser-only profile (from before profiles lived on the server): when the server has none and
 * this browser does, it is pushed up once. A failed push keeps the browser copy and is retried on
 * the next read. TanStack Query runs one fetch per key at a time, so the push never doubles.
 */
async function fetchProfile(user: UserApi): Promise<UserProfile> {
  const server = await user.get()
  const store = storage()
  if (!isMigrated(store)) {
    const local = loadProfile(store)
    if (isEmptyProfile(server) && !isEmptyProfile(local)) {
      try {
        const saved = await user.update(local)
        markMigrated(store)
        saveProfile(store, saved)
        return saved
      } catch {
        return local
      }
    }
    markMigrated(store)
  }
  saveProfile(store, server)
  return server
}

/**
 * The owner's name and personal context. The server is the source of truth; until it answers (or
 * when it can't be reached) the copy cached in this browser is shown, so the greeting and the
 * sidebar never flash empty.
 *
 * reason: the personal context is the owner's own text and later feeds the `human` core memory
 * block (D4.1). Render it as text only (never as HTML or markdown that runs), and the prompt
 * assembler must quote it as data, never as instructions.
 */
export function useProfile() {
  const { user } = useApi()
  const [cached] = useState(() => loadProfile(storage()))
  const query = useQuery({
    queryKey: keys.user(),
    queryFn: () => fetchProfile(user),
    placeholderData: cached,
  })
  return {
    profile: query.data ?? cached,
    /** True until the server has answered once. */
    loading: query.isPending || query.isPlaceholderData,
    failed: query.isError,
  }
}

/** Saves the whole profile: shown at once, rolled back with a toast if the server refuses. */
export function useSaveProfile() {
  const { user } = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (next: UserProfile) => user.update(next),
    onMutate: async (next) => {
      await client.cancelQueries({ queryKey: keys.user() })
      const previous = client.getQueryData<UserProfile>(keys.user())
      client.setQueryData<UserProfile>(keys.user(), {
        name: next.name.trim(),
        personalContext: next.personalContext,
      })
      return { previous }
    },
    onError: async (_err, _next, result) => {
      toast(SAVE_FAILED)
      if (result?.previous) client.setQueryData(keys.user(), result.previous)
      else await client.invalidateQueries({ queryKey: keys.user() })
    },
    onSuccess: (saved) => {
      client.setQueryData(keys.user(), saved)
      const store = storage()
      saveProfile(store, saved)
      // An explicit save settles the move too: an old browser copy must never overwrite it.
      markMigrated(store)
    },
  })
}
