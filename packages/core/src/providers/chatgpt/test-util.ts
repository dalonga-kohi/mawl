import type { StoredChatGptCredential } from './stored.ts'

/** Never a real token: tests assert these strings do not leak. */
export const ACCESS = 'access-token-AAAA'
export const REFRESH = 'refresh-token-RRRR'
export const ID_TOKEN_SECRET_MARK = 'idtok'
export const CLIENT_ID = 'oaiapp_testclient123'
export const HOST_ID = 'urn:uuid:3f1c1b4e-2d7a-4b0e-9c5f-7a1e0d2b8c11'
export const ALL_SCOPES =
  'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'

const b64url = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')

/** An unsigned JWT: the sign-in code reads claims only, as the token came straight over TLS. */
export function makeIdToken(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(claims)}.${ID_TOKEN_SECRET_MARK}`
}

export interface FetchCall {
  url: string
  method: string
  headers: Headers
  body: string
  redirect: RequestInit['redirect']
}

export type Responder = (call: FetchCall, index: number) => Response | Promise<Response>

/** A scripted fetch that records every call. A response function or a fixed list (last one repeats). */
export function scriptedFetch(script: Responder | Response[]) {
  const calls: FetchCall[] = []
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : String(init?.body ?? ''),
      redirect: init?.redirect,
    }
    const index = calls.push(call) - 1
    if (typeof script === 'function') return script(call, index)
    const res = script[Math.min(index, script.length - 1)]
    if (!res) throw new Error('no scripted response')
    return res.clone()
  }) as typeof globalThis.fetch
  return { fetch, calls }
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

export function tokenResponse(over: Record<string, unknown> = {}) {
  return json({
    access_token: ACCESS,
    refresh_token: REFRESH,
    id_token: makeIdToken({}),
    token_type: 'Bearer',
    expires_in: 3600,
    scope: ALL_SCOPES,
    ...over,
  })
}

export function stored(over: Partial<StoredChatGptCredential> = {}): StoredChatGptCredential {
  return {
    clientId: CLIENT_ID,
    accessToken: ACCESS,
    refreshToken: REFRESH,
    idToken: null,
    expiresAt: 10_000_000,
    scope: ALL_SCOPES,
    ...over,
  }
}

/** In-memory TokenStore that records every save in order. */
export function memoryStore(initial: StoredChatGptCredential) {
  let current = initial
  const log: string[] = []
  return {
    log,
    get current() {
      return current
    },
    async load() {
      return current
    },
    async save(next: StoredChatGptCredential) {
      log.push(`save:${next.refreshToken}`)
      current = next
    },
    async clearTokens() {
      log.push('clear')
      current = { ...current, accessToken: null, refreshToken: null, idToken: null, expiresAt: 0 }
    },
  }
}

/** Reads an SSE response into its decoded text. */
export async function drain(res: Response): Promise<string> {
  return await res.text()
}

export const sse = (...events: unknown[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  })
