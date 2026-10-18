import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type contract, type LenientEnvelope, newId } from '@faire/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { type ClientOptions } from 'ws'
import { createLogger } from '../logger.ts'
import { unusedProviders } from '../providers/test-util.ts'
import { createRouter } from '../router.ts'
import { unusedRuns } from '../runs/test-util.ts'
import type { ConnectionState, EventsService } from './service.ts'
import { attachWsHub, type WsHub, type WsHubOptions } from './ws.ts'

const profileId = newId('profile')
const envelope = (id: string): LenientEnvelope => ({
  v: 1,
  id,
  type: 'notify',
  profileId,
  ts: '2026-01-01T00:00:00.000Z',
  payload: { title: 't', body: 'b', level: 'info' },
})

describe('WebSocket hub', () => {
  const cleanup: (() => Promise<void>)[] = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0).reverse()) await fn()
  })

  async function setup(allowedOrigins: string[] = [], hubOptions: Partial<WsHubOptions> = {}) {
    const connections: ConnectionState[] = []
    const aborted: boolean[] = []
    const events: EventsService = {
      async *subscribe(_input, { connection, signal }) {
        connections.push(connection)
        yield envelope('1')
        // Stays open until the transport goes away.
        await new Promise<void>((resolve) => {
          const done = () => {
            aborted.push(true)
            resolve()
          }
          if (signal?.aborted) done()
          else signal?.addEventListener('abort', done, { once: true })
        })
      },
    }
    const server: Server = createServer((_req, res) => res.end('http'))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const hub: WsHub = attachWsHub({
      server,
      router: createRouter({
        version: '1',
        providers: unusedProviders,
        runs: unusedRuns,
        events,
      }),
      logger: createLogger({ level: 'silent' }),
      allowedOrigins,
      closeGraceMs: 200,
      ...hubOptions,
    })
    cleanup.push(async () => {
      await hub.close()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    })
    const open = (path = '/ws', origin?: string, host?: string, extra: ClientOptions = {}) =>
      new WebSocket(`ws://127.0.0.1:${port}${path}`, {
        ...extra,
        ...(origin ? { origin } : {}),
        ...(host ? { headers: { host } } : {}),
      })
    const client = (ws: WebSocket) => {
      cleanup.push(async () => ws.terminate())
      return createORPCClient(new RPCLink({ websocket: ws as never })) as ContractRouterClient<
        typeof contract
      >
    }
    return { hub, open, client, connections, aborted, port }
  }

  const outcome = (ws: WebSocket) =>
    new Promise<string>((resolve) => {
      ws.on('open', () => resolve('open'))
      ws.on('unexpected-response', (_req, res) => resolve(`http ${res.statusCode}`))
      ws.on('error', (err) => resolve(`error ${err.message}`))
    })

  it('streams events.subscribe over a socket without an Origin header', async () => {
    const { open, client, connections } = await setup()
    const ws = open()
    const rpc = client(ws)
    const stream = await rpc.events.subscribe({ topics: ['profile:*'] })
    const first = await stream[Symbol.asyncIterator]().next()
    expect(first.value).toEqual(envelope('1'))
    expect(connections).toHaveLength(1)
  })

  it('answers 403 to a browser origin that is not allowed', async () => {
    const { open } = await setup()
    expect(await outcome(open('/ws', 'https://evil.example'))).toBe('http 403')
  })

  it.each(['http://localhost:5173', 'tauri://localhost'])(
    'accepts the origin %s',
    async (origin) => {
      const { open } = await setup()
      const ws = open('/ws', origin)
      cleanup.push(async () => ws.terminate())
      expect(await outcome(ws)).toBe('open')
    },
  )

  it('accepts an origin from the allow list', async () => {
    const { open } = await setup(['https://faire.example.com'])
    const ws = open('/ws', 'https://faire.example.com')
    cleanup.push(async () => ws.terminate())
    expect(await outcome(ws)).toBe('open')
  })

  it('answers 403 to a Host that is not ours, even from a non-browser client (DNS rebinding)', async () => {
    const { open } = await setup()
    expect(await outcome(open('/ws', undefined, 'evil.example:7420'))).toBe('http 403')
    expect(await outcome(open('/ws', 'http://evil.example:7420', 'evil.example:7420'))).toBe(
      'http 403',
    )
  })

  it.each(['localhost:7420', 'dev.localhost', '[::1]:7420', 'faire.example.com:7420'])(
    'accepts the Host %s',
    async (host) => {
      const { open } = await setup(['https://faire.example.com'])
      const ws = open('/ws', undefined, host)
      cleanup.push(async () => ws.terminate())
      expect(await outcome(ws)).toBe('open')
    },
  )
  it('drops upgrades on any other path', async () => {
    const { open } = await setup()
    expect(await outcome(open('/rpc'))).toMatch(/^error/)
    expect(await outcome(open('/ws/extra'))).toMatch(/^error/)
  })

  it('gives every socket its own connection state, shared by its subscriptions', async () => {
    const { open, client, connections } = await setup()
    const rpcA = client(open())
    const rpcB = client(open())
    for (const rpc of [rpcA, rpcA, rpcB]) {
      const stream = await rpc.events.subscribe({ topics: ['profile:*'] })
      await stream[Symbol.asyncIterator]().next()
    }
    expect(connections[0]).toBe(connections[1])
    expect(connections[2]).not.toBe(connections[0])
  })

  it('closes a frame larger than the payload cap', async () => {
    const { open } = await setup()
    const ws = open()
    cleanup.push(async () => ws.terminate())
    await outcome(ws)
    const code = new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)))
    ws.send(Buffer.alloc(100 * 1024))
    expect(await code).toBe(1009)
  })

  it('aborts the stream when the client disconnects', async () => {
    const { open, client, aborted } = await setup()
    const ws = open()
    const rpc = client(ws)
    const stream = await rpc.events.subscribe({ topics: ['profile:*'] })
    await stream[Symbol.asyncIterator]().next()
    ws.close()
    await vi.waitFor(() => expect(aborted).toEqual([true]))
  })

  it('close() ends open streams, refuses new upgrades and does not hang', async () => {
    const { hub, open, client, aborted } = await setup()
    const ws = open()
    const rpc = client(ws)
    const stream = await rpc.events.subscribe({ topics: ['profile:*'] })
    await stream[Symbol.asyncIterator]().next()
    expect(hub.connections).toBe(1)
    await hub.close()
    expect(hub.connections).toBe(0)
    await vi.waitFor(() => expect(aborted).toEqual([true]))
    expect(await outcome(open())).toMatch(/^error/)
  })

  describe('liveness and the connection cap', () => {
    afterEach(() => void vi.useRealTimers())
    const closed = (ws: WebSocket) =>
      new Promise<void>((resolve) => ws.once('close', () => resolve()))
    const opened = (ws: WebSocket) =>
      new Promise<void>((resolve) => ws.once('open', () => resolve()))

    it('terminates a socket that missed the last pong', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      const { open, hub } = await setup()
      const ws = open('/ws', undefined, undefined, { autoPong: false })
      cleanup.push(async () => ws.terminate())
      await opened(ws)
      expect(hub.connections).toBe(1)
      const gone = closed(ws)
      vi.advanceTimersByTime(30_000) // ping sent, no pong comes back
      expect(hub.connections).toBe(1)
      vi.advanceTimersByTime(30_000) // still silent: dropped
      await gone
      await vi.waitFor(() => expect(hub.connections).toBe(0), { timeout: 2000 })
    })

    it('keeps a socket that answers every ping', async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
      const { open, hub } = await setup()
      const ws = open()
      cleanup.push(async () => ws.terminate())
      await opened(ws)
      for (let round = 0; round < 3; round++) {
        const pinged = new Promise<void>((resolve) => ws.once('ping', () => resolve()))
        vi.advanceTimersByTime(30_000)
        await pinged
        // Let the automatic pong travel back before the next tick.
        await new Promise<void>((resolve) => setImmediate(resolve))
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      expect(ws.readyState).toBe(WebSocket.OPEN)
      expect(hub.connections).toBe(1)
    })

    it('answers 503 and logs once the connection cap is reached, and accepts again after one leaves', async () => {
      const lines: string[] = []
      const { open, hub } = await setup([], {
        maxConnections: 2,
        logger: createLogger({
          level: 'warn',
          stream: { write: (chunk: string) => void lines.push(chunk) },
        }),
      })
      const a = open()
      const b = open()
      cleanup.push(async () => {
        a.terminate()
        b.terminate()
      })
      await Promise.all([opened(a), opened(b)])
      expect(await outcome(open())).toBe('http 503')
      expect(lines.join('')).toContain('connection cap')
      a.close()
      await vi.waitFor(() => expect(hub.connections).toBe(1))
      const c = open()
      cleanup.push(async () => c.terminate())
      expect(await outcome(c)).toBe('open')
    })
  })
})
