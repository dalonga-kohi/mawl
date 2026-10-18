import { type LenientEnvelope, newId, type ProfileId } from '@faire/contracts'
import { createORPCClient } from '@orpc/client'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'
import { QueryClient } from '@tanstack/query-core'
import type { FaireClient } from './client.ts'
import type { EventsApi, EventsSubscribeInput } from './event-store.ts'

/** One open `events.subscribe` call the test controls. */
export interface FakeStream {
  input: EventsSubscribeInput
  signal: AbortSignal
  /** True once the consumer stopped reading (iterator `return` was called). */
  returned: boolean
  push(item: unknown): void
  end(): void
  fail(err: unknown): void
}

/** An `events.subscribe` stand-in: every call opens a stream the test drives by hand. */
export function fakeEvents() {
  const streams: FakeStream[] = []
  let failNext: unknown
  const api: EventsApi = {
    async subscribe(input, options) {
      if (failNext !== undefined) {
        const err = failNext
        failNext = undefined
        throw err
      }
      const queue: ({ item: unknown } | { end: true } | { error: unknown })[] = []
      let wake: (() => void) | undefined
      const send = (entry: (typeof queue)[number]) => {
        queue.push(entry)
        wake?.()
      }
      const stream: FakeStream = {
        input,
        signal: options?.signal ?? new AbortController().signal,
        returned: false,
        push: (item) => send({ item }),
        end: () => send({ end: true }),
        fail: (error) => send({ error }),
      }
      streams.push(stream)
      return {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              for (;;) {
                const head = queue.shift()
                if (head) {
                  if ('item' in head) return { done: false, value: head.item as LenientEnvelope }
                  if ('error' in head) throw head.error
                  return { done: true, value: undefined }
                }
                await new Promise<void>((resolve) => {
                  wake = resolve
                })
              }
            },
            async return() {
              stream.returned = true
              return { done: true, value: undefined }
            },
          }
        },
      }
    },
  }
  return {
    api,
    streams,
    /** Makes the next subscribe call reject (for example a refused socket). */
    failNextSubscribe(err: unknown) {
      failNext = err
    },
  }
}

export const profileId: ProfileId = newId('profile')

let nextId = 1
/** A wire item. `id` defaults to a rising number. */
export function wire(
  type: string,
  payload: unknown,
  over: { id?: string | number; runId?: string; v?: number } = {},
): Record<string, unknown> {
  return {
    v: over.v ?? 1,
    id: String(over.id ?? nextId++),
    type,
    profileId,
    ...(over.runId ? { runId: over.runId } : {}),
    ts: '2026-01-01T00:00:00.000Z',
    payload,
  }
}

/** Query utils whose client never reaches a network: only the keys matter in tests. */
export function keyUtils() {
  const client = createORPCClient<FaireClient>({
    call: async () => {
      throw new Error('no network in tests')
    },
  })
  return createTanstackQueryUtils(client)
}

export const newQueryClient = () => new QueryClient()
