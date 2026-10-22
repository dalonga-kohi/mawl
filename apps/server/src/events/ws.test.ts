import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { type contract, type LenientEnvelope, newId } from '@mawl/contracts'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { type ClientOptions } from 'ws'
import { TEST_AUTH_TOKEN, TEST_WS_PROTOCOLS } from '../auth/test-util.ts'
import { WS_PROTOCOL, WS_TOKEN_PREFIX } from '../auth/token.ts'
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
      authToken: TEST_AUTH_TOKEN,
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
    const open = (
      path = '/ws',
      origin?: string,
      host?: string,
      extra: ClientOptions = {},
      protocols: string[] = TEST_WS_PROTOCOLS,
    ) =>
      new WebSocket(`ws://127.0.0.1:${port}${path}`, protocols, {
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

  describe('auth token (subprotocol)', () => {
    const tokenProtocol = (token: string) => `${WS_TOKEN_PREFIX}${token}`

    it('opens with the right token and echoes mawl.v1, never the token', async () => {
      const { open } = await setup()
      const ws = open()
      cleanup.push(async () => ws.terminate())
      expect(await outcome(ws)).toBe('open')
      expect(ws.protocol).toBe(WS_PROTOCOL)
    })

    it('still opens when the token is offered first', async () => {
      const { open } = await setup()
      const ws = open('/ws', undefined, undefined, {}, [
        tokenProtocol(TEST_AUTH_TOKEN),
        WS_PROTOCOL,
      ])
      cleanup.push(async () => ws.terminate())
      expect(await outcome(ws)).toBe('open')
      expect(ws.protocol).toBe(WS_PROTOCOL)
    })

    it.each([
      ['no subprotocols', []],
      ['mawl.v1 alone', [WS_PROTOCOL]],
      ['a wrong token', [WS_PROTOCOL, tokenProtocol(`${TEST_AUTH_TOKEN.slice(1)}x`)]],
      ['a shorter token', [WS_PROTOCOL, tokenProtocol(TEST_AUTH_TOKEN.slice(0, 32))]],
      ['a longer token', [WS_PROTOCOL, tokenProtocol(`${TEST_AUTH_TOKEN}x`)]],
      ['the token without mawl.v1', [tokenProtocol(TEST_AUTH_TOKEN)]],
    ])('refuses the upgrade with 401 for %s', async (_name, protocols) => {
      const { open } = await setup()
      expect(await outcome(open('/ws', undefined, undefined, {}, protocols))).toBe('http 401')
    })

    it('ignores a token in the url', async () => {
      const { open } = await setup()
      const ws = open(`/ws?token=${TEST_AUTH_TOKEN}`, undefined, undefined, {}, [WS_PROTOCOL])
      expect(await outcome(ws)).toBe('http 401')
    })

    it('ignores a Bearer header: only the subprotocol counts on /ws', async () => {
      const { open } = await setup()
      const ws = open(
        '/ws',
        undefined,
        undefined,
        {
          headers: { authorization: `Bearer ${TEST_AUTH_TOKEN}` },
        },
        [WS_PROTOCOL],
      )
      expect(await outcome(ws)).toBe('http 401')
    })

    it('checks Host and Origin before the token', async () => {
      const { open } = await setup()
      expect(await outcome(open('/ws', undefined, 'evil.example:7420'))).toBe('http 403')
      expect(await outcome(open('/ws', 'https://evil.example'))).toBe('http 403')
    })

    it('never logs the token, right or wrong', async () => {
      const lines: string[] = []
      const { open } = await setup([], {
        logger: createLogger({
          level: 'debug',
          stream: { write: (chunk: string) => void lines.push(chunk) },
        }),
      })
      const ok = open()
      cleanup.push(async () => ok.terminate())
      await outcome(ok)
      await outcome(
        open('/ws', undefined, undefined, {}, [WS_PROTOCOL, tokenProtocol(`${TEST_AUTH_TOKEN}zz`)]),
      )
      await outcome(open(`/ws?token=${TEST_AUTH_TOKEN}`, undefined, undefined, {}, []))
      expect(lines.join('')).toContain('unauthorized')
      expect(lines.join('')).not.toContain(TEST_AUTH_TOKEN)
    })
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
    const { open } = await setup(['https://mawl.example.com'])
    const ws = open('/ws', 'https://mawl.example.com')
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

  it.each(['localhost:7420', 'dev.localhost', '[::1]:7420', 'mawl.example.com:7420'])(
    'accepts the Host %s',
    async (host) => {
      const { open } = await setup(['https://mawl.example.com'])
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
