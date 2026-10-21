import type { UserProfile } from '@mawl/contracts'
import type { UserApi } from '../api/chat-api.ts'

/** An in-memory `user.*` backend. Gates hold a call open until they resolve (a request in flight). */
export function fakeUserApi(initial: UserProfile = { name: '', personalContext: '' }) {
  const state = {
    profile: { ...initial },
    gets: 0,
    updates: [] as UserProfile[],
    getError: null as Error | null,
    updateError: null as Error | null,
    getGate: null as Promise<void> | null,
    updateGate: null as Promise<void> | null,
  }
  const api: UserApi = {
    get: async () => {
      state.gets++
      if (state.getGate) await state.getGate
      if (state.getError) throw state.getError
      return { ...state.profile }
    },
    update: async (input) => {
      if (state.updateGate) await state.updateGate
      if (state.updateError) throw state.updateError
      state.updates.push(input)
      // Like the contract: the name is trimmed.
      state.profile = { name: input.name.trim(), personalContext: input.personalContext }
      return { ...state.profile }
    },
  }
  return { api, state }
}

/** A promise plus the function that settles it, for gating fake calls. */
export function gate() {
  let open = () => {}
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}
