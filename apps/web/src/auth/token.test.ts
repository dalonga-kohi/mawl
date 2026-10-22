import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearStoredToken,
  launchToken,
  OWNER_TOKEN_KEY,
  readStoredToken,
  storeToken,
  verifyToken,
} from './token.ts'

const TOKEN = 'web-owner-token_0123456789abcdefghijk'

describe('launchToken', () => {
  afterEach(() => {
    delete (window as { __MAWL_LAUNCH_TOKEN__?: unknown }).__MAWL_LAUNCH_TOKEN__
  })

  it('reads the token the desktop host injects', () => {
    ;(window as { __MAWL_LAUNCH_TOKEN__?: unknown }).__MAWL_LAUNCH_TOKEN__ = TOKEN
    expect(launchToken(window)).toBe(TOKEN)
  })

  it.each([undefined, 42, '', 'short', `${TOKEN} `])('ignores %j', (value) => {
    ;(window as { __MAWL_LAUNCH_TOKEN__?: unknown }).__MAWL_LAUNCH_TOKEN__ = value
    expect(launchToken(window)).toBeUndefined()
  })
})

describe('stored owner token', () => {
  afterEach(() => sessionStorage.clear())

  it('keeps the token for this tab only (sessionStorage) and clears it', () => {
    expect(readStoredToken(sessionStorage)).toBeUndefined()
    storeToken(sessionStorage, TOKEN)
    expect(sessionStorage.getItem(OWNER_TOKEN_KEY)).toBe(TOKEN)
    expect(localStorage.getItem(OWNER_TOKEN_KEY)).toBeNull()
    expect(readStoredToken(sessionStorage)).toBe(TOKEN)
    clearStoredToken(sessionStorage)
    expect(readStoredToken(sessionStorage)).toBeUndefined()
  })

  it('drops a stored value that is not a token', () => {
    sessionStorage.setItem(OWNER_TOKEN_KEY, 'not a token')
    expect(readStoredToken(sessionStorage)).toBeUndefined()
  })

  it('survives storage that throws (private mode)', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
      removeItem: () => {
        throw new Error('denied')
      },
    } as unknown as Storage
    expect(readStoredToken(broken)).toBeUndefined()
    expect(() => storeToken(broken, TOKEN)).not.toThrow()
    expect(() => clearStoredToken(broken)).not.toThrow()
    expect(readStoredToken(null)).toBeUndefined()
  })
})

describe('verifyToken', () => {
  it('asks health.get over /rpc with the Bearer header, never the url', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 200 }))
    expect(await verifyToken(TOKEN, { origin: 'http://127.0.0.1:7420', fetch })).toBe('ok')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:7420/rpc/health/get')
    expect(url).not.toContain(TOKEN)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(init.method).toBe('POST')
  })

  it('reports a refused token as unauthorized', async () => {
    const fetch = vi.fn(async () => new Response('{}', { status: 401 }))
    expect(await verifyToken(TOKEN, { origin: 'http://x', fetch })).toBe('unauthorized')
  })

  it.each([
    ['a network error', async () => Promise.reject(new TypeError('failed'))],
    ['a server error', async () => new Response('', { status: 503 })],
    ['a forbidden Host', async () => new Response('', { status: 403 })],
  ])('reports %s as unreachable', async (_n, impl) => {
    expect(await verifyToken(TOKEN, { origin: 'http://x', fetch: vi.fn(impl) })).toBe('unreachable')
  })

  it('reports a malformed token as unauthorized without sending it', async () => {
    const fetch = vi.fn()
    expect(await verifyToken('nope', { origin: 'http://x', fetch })).toBe('unauthorized')
    expect(fetch).not.toHaveBeenCalled()
  })
})
