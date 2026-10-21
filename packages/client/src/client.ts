import type { contract } from '@mawl/contracts'
import { type ClientLink, createORPCClient, DynamicLink } from '@orpc/client'
import { RPCLink, type RPCLinkOptions } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import { createTanstackQueryUtils, type RouterUtils } from '@orpc/tanstack-query'

/** The typed client for the whole contract. */
export type MawlClient = ContractRouterClient<typeof contract>
/** TanStack Query options and keys for every procedure of {@link MawlClient}. */
export type MawlQueryUtils = RouterUtils<MawlClient>

type LinkSocket = RPCLinkOptions<Record<never, never>>['websocket']

/** What the client needs from a socket; the browser `WebSocket` and the `ws` package both fit. */
// `readyState` comes from the link's socket type; redeclaring it as `number` breaks under the DOM
// lib, where it is `0 | 1 | 2 | 3`.
export interface MawlSocket extends LinkSocket {
  close(code?: number, reason?: string): void
}
export type MawlSocketConstructor = new (url: string) => MawlSocket

export interface MawlClientOptions {
  /** `ws://` or `wss://` url of the server's `/ws` endpoint. */
  url: string
  /** Defaults to the global `WebSocket`. Pass one in Node or in tests. */
  WebSocket?: MawlSocketConstructor
}

export interface MawlClientHandle {
  client: MawlClient
  utils: MawlQueryUtils
  /** Closes the socket. Later calls open a new one; the event store stops separately. */
  close(): void
}

const CONNECTING = 0
const OPEN = 1

/**
 * A typed oRPC client over one WebSocket. A socket cannot be reopened, so the link opens a new one
 * for the first call after the old one closed; that is what lets the event store reconnect.
 */
export function createMawlClient(options: MawlClientOptions): MawlClientHandle {
  const found = options.WebSocket ?? (globalThis as { WebSocket?: MawlSocketConstructor }).WebSocket
  if (!found) throw new Error('No WebSocket implementation: pass options.WebSocket')
  const Socket: MawlSocketConstructor = found

  let current: { socket: MawlSocket; link: ClientLink<Record<never, never>> } | undefined

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

  const client = createORPCClient<MawlClient>(new DynamicLink(() => link()))
  return {
    client,
    utils: createTanstackQueryUtils(client),
    close() {
      current?.socket.close(1000)
      current = undefined
    },
  }
}
