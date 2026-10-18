import type { contract } from '@faire/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import type { Api } from './ApiProvider.tsx'

/**
 * The live API for the browser. The web app is served by faire-server (or proxied to it by the
 * Vite dev server), so `/rpc` on the page's own origin reaches it.
 * TODO(P1.5 merge): build this from `createFaireClient` in @faire/client.
 */
export function createApi(origin: string = window.location.origin): Api {
  const rpc: ContractRouterClient<typeof contract> = createORPCClient(
    new RPCLink({ url: `${origin}/rpc` }),
  )
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
