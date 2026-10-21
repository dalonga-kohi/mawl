import { createMawlClient } from '@mawl/client'
import type { ProfileId, RunId, ThreadId } from '@mawl/contracts'
import { partialMatchKey } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { keys, MESSAGE_PAGE } from './keys.ts'

// Building keys never opens a socket, so a constructor that throws proves nothing connects.
class NoSocket {
  constructor() {
    throw new Error('no socket in key tests')
  }
}
const { utils } = createMawlClient({ url: 'ws://127.0.0.1:1/ws', WebSocket: NoSocket as never })

const profileId = 'prof_01JTEST0000000000000000001' as ProfileId
const threadId = 'thr_01JTEST0000000000000000001' as ThreadId
const runId = 'run_01JTEST0000000000000000001' as RunId

describe('query keys', () => {
  it('match the keys @orpc/tanstack-query generates for the same calls', () => {
    expect(keys.profiles()).toEqual(utils.profiles.list.queryKey())
    expect(keys.threads(profileId)).toEqual(utils.threads.list.queryKey({ input: { profileId } }))
    expect(keys.run(runId)).toEqual(utils.runs.get.queryKey({ input: { id: runId } }))
    expect(keys.messages(threadId)).toEqual(
      utils.threads.messages.infiniteKey({
        input: () => ({ threadId, limit: MESSAGE_PAGE }),
        initialPageParam: undefined,
      }),
    )
  })

  it('are reached by the event store invalidations for threads and runs', () => {
    expect(partialMatchKey(keys.threads(profileId), utils.threads.key())).toBe(true)
    expect(partialMatchKey(keys.messages(threadId), utils.threads.key())).toBe(true)
    expect(partialMatchKey(keys.run(runId), utils.runs.key())).toBe(true)
    expect(partialMatchKey(keys.profiles(), utils.threads.key())).toBe(false)
  })
})
