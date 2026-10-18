import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/ws'
import { type WebSocket, WebSocketServer } from 'ws'
import type { Logger } from '../logger.ts'
import type { createRouter, RouterContext } from '../router.ts'
import { checkHost } from './host.ts'
import { checkOrigin } from './origin.ts'
import { newConnectionState } from './service.ts'

/** The only upgrade path. */
export const WS_PATH = '/ws'
/** Client frames are small oRPC requests; anything larger is a mistake or an attack. */
export const WS_MAX_PAYLOAD = 64 * 1024
const CLOSE_GRACE_MS = 1000

export interface WsHubOptions {
  server: Server
  router: ReturnType<typeof createRouter>
  logger: Logger
  allowedOrigins?: readonly string[] | undefined
  /** The address the server listens on; its name is an accepted Host. Defaults to 127.0.0.1. */
  bindHost?: string | undefined
  /** How long close() waits for clients to answer the close frame before dropping them. */
  closeGraceMs?: number
}

export interface WsHub {
  readonly connections: number
  /** Stops upgrading, closes every socket (ending their streams) and resolves when they are gone. */
  close(): Promise<void>
}

function reject(socket: Duplex, status: number, text: string): void {
  if (socket.writable) {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  }
  socket.destroy()
}

/**
 * Serves the oRPC router over WebSocket on the HTTP server's `upgrade` event, at `/ws` only.
 * Each socket carries its own connection state (the subscription cap). Authentication is the
 * device pairing of P6.1; until then the Origin check is the only gate for browsers.
 */
export function attachWsHub(options: WsHubOptions): WsHub {
  const { server, logger } = options
  const allowed = options.allowedOrigins ?? []
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD })
  const handler = new RPCHandler<RouterContext>(options.router, {
    // Procedure path and error code only, as on the HTTP transport.
    clientInterceptors: [
      onError((error, { path }) => {
        const code = error instanceof ORPCError ? error.code : 'INTERNAL_SERVER_ERROR'
        logger.warn({ procedure: path.join('.'), code, transport: 'ws' }, 'rpc error')
      }),
    ],
  })
  let closed = false

  function onUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    // A socket error before the handshake finishes would otherwise be an uncaught exception.
    socket.on('error', () => {})
    if (closed) return void socket.destroy()

    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://faire.invalid').pathname
    } catch {
      logger.warn({ reason: 'bad_url' }, 'websocket upgrade rejected')
      return void reject(socket, 400, 'Bad Request')
    }
    if (pathname !== WS_PATH) {
      logger.warn({ reason: 'unknown_path', path: pathname.slice(0, 100) }, 'upgrade rejected')
      return void socket.destroy()
    }
    // Before the Origin check: a rebound name makes Origin and Host agree, and a non-browser client sends no Origin.
    const hostVerdict = checkHost(req.headers.host, {
      bindHost: options.bindHost ?? '127.0.0.1',
      allowedOrigins: allowed,
    })
    if (!hostVerdict.ok) {
      logger.warn(
        { reason: hostVerdict.reason, host: req.headers.host?.slice(0, 200) },
        'upgrade rejected',
      )
      return void reject(socket, 403, 'Forbidden')
    }
    const origin = req.headers.origin
    const verdict = checkOrigin({ origin, host: req.headers.host, allowed })
    if (!verdict.ok) {
      logger.warn({ reason: verdict.reason, origin: origin?.slice(0, 200) }, 'upgrade rejected')
      return void reject(socket, 403, 'Forbidden')
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      ws.on('error', (err) => logger.debug({ errName: err.name }, 'websocket error'))
      void handler.upgrade(ws, { context: { connection: newConnectionState() } })
    })
  }
  server.on('upgrade', onUpgrade)

  return {
    get connections() {
      return wss.clients.size
    },
    async close() {
      closed = true
      // The listener stays: once closed it destroys late upgrades instead of letting HTTP answer them.
      const clients = [...wss.clients]
      await new Promise<void>((resolve) => {
        if (clients.length === 0) return resolve()
        let open = clients.length
        const done = () => {
          if (--open === 0) {
            clearTimeout(force)
            resolve()
          }
        }
        const force = setTimeout(() => {
          for (const c of clients) c.terminate()
        }, options.closeGraceMs ?? CLOSE_GRACE_MS)
        for (const c of clients) {
          c.once('close', done)
          c.close(1001, 'server shutting down')
        }
      })
      await new Promise<void>((resolve) => wss.close(() => resolve()))
    },
  }
}
