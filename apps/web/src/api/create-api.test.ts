import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApi, socketUrl } from './create-api.ts'

/** Records every socket the client opens; never connects. */
class RecordingSocket {
  static opened: string[] = []
  readyState = 0
  constructor(readonly url: string) {
    RecordingSocket.opened.push(url)
  }
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {
    this.readyState = 3
  }
}

describe('createApi', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    RecordingSocket.opened = []
  })

  it('runs queries and the event stream over one shared socket', async () => {
    vi.stubGlobal('WebSocket', RecordingSocket)
    const api = createApi('http://localhost:5173')
    const live = api.live(new QueryClient())
    void api.profiles.list().catch(() => {})
    live.start()
    void api.threads.list('prf_01JTEST0000000000000000001' as never).catch(() => {})
    await vi.waitFor(() => expect(RecordingSocket.opened.length).toBeGreaterThan(0))
    // One macrotask: lets every queued call reach the link before counting.
    await new Promise((r) => setTimeout(r, 0))
    expect(RecordingSocket.opened).toEqual(['ws://localhost:5173/ws'])
    live.stop()
  })
})

describe('socketUrl', () => {
  it('uses ws:// for a plain http page', () => {
    expect(socketUrl('http://localhost:5173')).toBe('ws://localhost:5173/ws')
  })

  it('uses wss:// for an https page, keeping host and port', () => {
    expect(socketUrl('https://faire.example.com:8443')).toBe('wss://faire.example.com:8443/ws')
  })

  it('ignores any path on the origin', () => {
    expect(socketUrl('http://127.0.0.1:7420/settings')).toBe('ws://127.0.0.1:7420/ws')
  })
})
