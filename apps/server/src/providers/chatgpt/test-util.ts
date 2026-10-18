import type { StartListener } from './listener.ts'

export const NOW = 1_800_000_000_000
export const CLIENT_ID = 'oaiapp_servertest42'
export const HOST_ID = 'urn:uuid:9d3a6c1e-5b7f-4a2d-8c10-3e4f5a6b7c8d'
export const ALL_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
export const EMAIL = 'owner@example.com'

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')

export function makeIdToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'RS256' })}.${b64url(claims)}.sig`
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export interface Call {
  url: string
  method: string
  headers: Headers
  body: string
}

/** A fetch fake that records calls and answers through `respond`. */
export function fakeFetch(respond: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : '',
    }
    return respond(call, calls.push(call) - 1)
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

export interface FakeListener {
  host: string
  port: number
  closed: boolean
  /** What the browser redirect would deliver. Resolves when the server finished handling it. */
  /** Mimics the real listener: a callback failing ccept is dropped and the attempt lives on. */
  callback(params: Record<string, string>): Promise<boolean>
}

/** A listener that binds nothing: tests deliver the callback by hand. */
export function fakeListeners() {
  const made: FakeListener[] = []
  const start: StartListener = async ({ host, port, accept, onCallback }) => {
    const listener: FakeListener = {
      host,
      port,
      closed: false,
      callback: async (params) => {
        const query = new URLSearchParams(params)
        if (accept && !accept(query)) return false
        await onCallback(query)
        return true
      },
    }
    made.push(listener)
    return {
      port,
      close: async () => {
        listener.closed = true
      },
    }
  }
  return { made, start, last: () => made[made.length - 1] }
}

export function tokenBody(over: Record<string, unknown> = {}) {
  return {
    access_token: 'access-token-AAAA',
    refresh_token: 'refresh-token-RRRR',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: ALL_SCOPES,
    ...over,
  }
}
