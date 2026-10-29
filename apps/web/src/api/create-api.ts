import { createEventStore, createMawlClient } from '@mawl/client'
import type { Api } from './ApiProvider.tsx'

/** The server's WebSocket endpoint on the same host as `origin`: `ws://` for http, `wss://` for https. */
export function socketUrl(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`
}

/**
 * The live API for the browser, over the shared @mawl/client WebSocket. The web app is served by
 * mawl-server (or proxied to it by the Vite dev server), so `/ws` on the page's own host reaches it.
 * Queries, mutations and the event stream all share that one socket.
 */
export function createApi(token: string, origin: string = window.location.origin): Api {
  // The token rides as a WebSocket subprotocol, never in the url (see auth/token.ts).
  const { client: rpc, utils } = createMawlClient({ url: socketUrl(origin), token })
  return {
    providers: {
      catalog: () => rpc.providers.catalog(),
      list: () => rpc.providers.list(),
      create: (input) => rpc.providers.create(input),
      remove: (id) => rpc.providers.delete({ id }),
      test: (target) => rpc.providers.test(target),
      chatgptStart: () => rpc.providers.chatgpt.start(),
      chatgptStatus: (attemptId) => rpc.providers.chatgpt.status({ attemptId }),
    },
    user: {
      get: () => rpc.user.get(),
      update: (input) => rpc.user.update(input),
    },
    profiles: {
      list: () => rpc.profiles.list(),
      create: (input) => rpc.profiles.create(input),
    },
    threads: {
      list: (profileId) => rpc.threads.list({ profileId }),
      messages: (input) => rpc.threads.messages(input),
    },
    runs: {
      start: (input) => rpc.runs.start(input),
      get: (id) => rpc.runs.get({ id }),
      cancel: (id) => rpc.runs.cancel({ id }),
    },
    approvals: {
      list: (input) => rpc.approvals.list(input),
      decide: (input) => rpc.approvals.decide(input),
    },
    live: (queryClient) => createEventStore({ events: rpc.events, queryClient, utils }),
  }
}
