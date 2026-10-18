import { describe, expect, it } from 'vitest'
import { createFaireClient } from './client.ts'

type Listener = (event: { data?: unknown }) => void

/** A socket that records what the client does and lets the test open or drop it. */
class FakeSocket {
  static instances: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  closedWith: number | undefined
  private listeners = new Map<string, Set<Listener>>()

  constructor(readonly url: string) {
    FakeSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>()
    this.listeners.set(type, set)
    set.add(listener)
  }
  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener)
  }
  send(data: unknown): void {
    this.sent.push(data)
  }
  close(code?: number): void {
    this.closedWith = code
    this.drop()
  }
  open(): void {
    this.readyState = 1
    for (const l of this.listeners.get('open') ?? []) l({})
  }
  drop(): void {
    this.readyState = 3
    for (const l of this.listeners.get('close') ?? []) l({})
  }
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

describe('createFaireClient', () => {
  const make = () => {
    FakeSocket.instances = []
    return createFaireClient({
      url: 'ws://127.0.0.1:7420/ws',
      WebSocket: FakeSocket as never,
    })
  }

  it('opens the socket on the first call and sends the request over it', async () => {
    const { client } = make()
    const pending = client.health.get().catch(() => {})
    expect(FakeSocket.instances).toHaveLength(1)
    expect(FakeSocket.instances[0]?.url).toBe('ws://127.0.0.1:7420/ws')
    FakeSocket.instances[0]?.open()
    await Promise.resolve()
    await flush()
    expect(FakeSocket.instances[0]?.sent.length).toBeGreaterThan(0)
    FakeSocket.instances[0]?.drop()
    await pending
  })

  it('reuses a socket that is still open', async () => {
    const { client } = make()
    const a = client.health.get().catch(() => {})
    const b = client.health.get().catch(() => {})
    expect(FakeSocket.instances).toHaveLength(1)
    FakeSocket.instances[0]?.drop()
    await Promise.all([a, b])
  })

  it('opens a fresh socket for the first call after the old one closed', async () => {
    const { client } = make()
    const first = client.health.get().catch(() => {})
    FakeSocket.instances[0]?.drop()
    await first
    const second = client.health.get().catch(() => {})
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1]?.drop()
    await second
  })

  it('close() closes the socket with a normal code', async () => {
    const { client, close } = make()
    const pending = client.health.get().catch(() => {})
    close()
    expect(FakeSocket.instances[0]?.closedWith).toBe(1000)
    await pending
  })

  it('builds TanStack Query keys from the contract', () => {
    const { utils } = make()
    expect(utils.health.get.queryKey()).toEqual(utils.health.get.queryKey())
    expect(utils.health.get.key()).toBeDefined()
  })

  it('fails with a clear message when there is no WebSocket implementation', () => {
    const original = (globalThis as { WebSocket?: unknown }).WebSocket
    ;(globalThis as { WebSocket?: unknown }).WebSocket = undefined
    try {
      expect(() => createFaireClient({ url: 'ws://x/ws' })).toThrow('No WebSocket implementation')
    } finally {
      ;(globalThis as { WebSocket?: unknown }).WebSocket = original
    }
  })
})
