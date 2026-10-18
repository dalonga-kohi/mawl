import { createFaireClient } from '@faire/client'
import type { Api } from './ApiProvider.tsx'

/** The server's WebSocket endpoint on the same host as `origin`: `ws://` for http, `wss://` for https. */
export function socketUrl(origin: string): string {
  const url = new URL(origin)
  return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`
}

/**
 * The live API for the browser, over the shared @faire/client WebSocket. The web app is served by
 * faire-server (or proxied to it by the Vite dev server), so `/ws` on the page's own host reaches it.
 */
export function createApi(origin: string = window.location.origin): Api {
  const { client: rpc } = createFaireClient({ url: socketUrl(origin) })
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
  }
}
