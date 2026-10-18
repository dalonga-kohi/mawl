import type { contract } from '@faire/contracts'
import { type ClientLink, createORPCClient, DynamicLink } from '@orpc/client'
import { RPCLink, type RPCLinkOptions } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import { createTanstackQueryUtils, type RouterUtils } from '@orpc/tanstack-query'

/** The typed client for the whole contract. */
export type FaireClient = ContractRouterClient<typeof contract>
/** TanStack Query options and keys for every procedure of {@link FaireClient}. */
export type FaireQueryUtils = RouterUtils<FaireClient>

type LinkSocket = RPCLinkOptions<Record<never, never>>['websocket']

/** What the client needs from a socket; the browser `WebSocket` and the `ws` package both fit. */
export interface FaireSocket extends LinkSocket {
  readonly readyState: number
  close(code?: number, reason?: string): void
}
export type FaireSocketConstructor = new (url: string) => FaireSocket

export interface FaireClientOptions {
  /** `ws://` or `wss://` url of the server's `/ws` endpoint. */
  url: string
  /** Defaults to the global `WebSocket`. Pass one in Node or in tests. */
  WebSocket?: FaireSocketConstructor
}

export interface FaireClientHandle {
  client: FaireClient
  utils: FaireQueryUtils
  /** Closes the socket. Later calls open a new one; the event store stops separately. */
  close(): void
}

const CONNECTING = 0
const OPEN = 1

/**
 * A typed oRPC client over one WebSocket. A socket cannot be reopened, so the link opens a new one
 * for the first call after the old one closed; that is what lets the event store reconnect.
 */
export function createFaireClient(options: FaireClientOptions): FaireClientHandle {
  const found =
    options.WebSocket ?? (globalThis as { WebSocket?: FaireSocketConstructor }).WebSocket
  if (!found) throw new Error('No WebSocket implementation: pass options.WebSocket')
  const Socket: FaireSocketConstructor = found

  let current: { socket: FaireSocket; link: ClientLink<Record<never, never>> } | undefined

  function link(): ClientLink<Record<never, never>> {
    if (
      !current ||
      (current.socket.readyState !== OPEN && current.socket.readyState !== CONNECTING)
    ) {
      const socket = new Socket(options.url)
      current = { socket, link: new RPCLink({ websocket: socket }) }
    }
    return current.link
  }

  const client = createORPCClient<FaireClient>(new DynamicLink(() => link()))
  return {
    client,
    utils: createTanstackQueryUtils(client),
    close() {
      current?.socket.close(1000)
      current = undefined
    },
  }
}
