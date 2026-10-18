import { ProviderFailureError } from '../failure.ts'
import { noRedirectFetch } from '../no-redirect-fetch.ts'
import { extractErrorCode, mapResponsesError } from './errors.ts'
import type { TokenManager } from './token-manager.ts'

/** Body fields the plan-usage Responses endpoint does not accept. */
const UNSUPPORTED_FIELDS = [
  'background',
  'conversation',
  'max_output_tokens',
  'max_tool_calls',
  'metadata',
  'moderation',
  'multi_agent',
  'prompt',
  'prompt_cache_retention',
  'safety_identifier',
  'temperature',
  'top_logprobs',
  'top_p',
  'truncation',
  'user',
  // Nothing is stored (store:false), so there is no response to continue from.
  'previous_response_id',
] as const

/** Headers that would tie a call to an API-key organisation or project. */
const DROPPED_HEADERS = ['openai-organization', 'openai-project']

const MAX_ERROR_BODY = 64 * 1024
const MAX_SSE_BUFFER = 1024 * 1024

export interface ChatGptFetchOptions {
  tokens: TokenManager
  fetch?: typeof globalThis.fetch
}

/**
 * Rewrites a Responses request for plan usage. Refuses what the endpoint cannot do rather
 * than sending a body that is certain to fail.
 */
function rewriteBody(raw: unknown): string {
  if (typeof raw !== 'string') throw new ProviderFailureError('unsupported_capability')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new ProviderFailureError('unsupported_capability')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ProviderFailureError('unsupported_capability')
  }
  const body = parsed as Record<string, unknown>
  if (body.stream !== true) throw new ProviderFailureError('unsupported_capability')
  body.store = false
  for (const key of UNSUPPORTED_FIELDS) delete body[key]
  if (Array.isArray(body.input)) {
    // The endpoint takes developer messages, not system ones.
    body.input = body.input.map((item: unknown) =>
      item && typeof item === 'object' && (item as { role?: unknown }).role === 'system'
        ? { ...item, role: 'developer' }
        : item,
    )
  }
  return JSON.stringify(body)
}

function retryAfterSeconds(res: Response): number | undefined {
  const raw = res.headers.get('retry-after')
  if (raw === null || !/^\d{1,6}$/.test(raw)) return undefined
  return Number(raw)
}

async function failureFrom(res: Response): Promise<ProviderFailureError> {
  let code: string | undefined
  try {
    const text = (await res.text()).slice(0, MAX_ERROR_BODY)
    code = extractErrorCode(JSON.parse(text))
  } catch {
    // A non-JSON body only means the status decides.
  }
  const retryAfter = retryAfterSeconds(res)
  return new ProviderFailureError(
    mapResponsesError(code, res.status),
    retryAfter === undefined ? {} : { retryAfter },
  )
}

/** The code inside a streamed `response.failed` or `error` event, if it has one. */
function streamedErrorCode(event: unknown): { failed: boolean; code: string | undefined } {
  if (!event || typeof event !== 'object') return { failed: false, code: undefined }
  const e = event as {
    type?: unknown
    code?: unknown
    error?: unknown
    response?: { error?: unknown }
  }
  if (e.type === 'response.failed') {
    return {
      failed: true,
      code: extractErrorCode(e.response?.error ? { error: e.response.error } : e.response),
    }
  }
  if (e.type === 'error') return { failed: true, code: extractErrorCode(e) }
  return { failed: false, code: undefined }
}

/**
 * Watches an event stream for failures the API reports after the 200 (plan limit mid-run, for
 * example) and ends the stream with a typed error. Healthy bytes pass through unchanged.
 */
function guardStream(res: Response): Response {
  if (!res.body) return res
  const decoder = new TextDecoder()
  let buffer = ''
  const guarded = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true })
        const events = buffer.split(/\r?\n\r?\n/)
        buffer = events.pop() ?? ''
        if (buffer.length > MAX_SSE_BUFFER) buffer = ''
        for (const block of events) {
          const data = block
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n')
          if (!data) continue
          let event: unknown
          try {
            event = JSON.parse(data)
          } catch {
            continue
          }
          const { failed, code } = streamedErrorCode(event)
          if (failed) {
            controller.error(new ProviderFailureError(mapResponsesError(code, res.status)))
            return
          }
        }
        controller.enqueue(chunk)
      },
    }),
  )
  return new Response(guarded, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  })
}

/**
 * The fetch handed to the OpenAI SDK for Sign in with ChatGPT. Every call gets a fresh bearer
 * from the token manager (the SDK's own key is a placeholder), redirects are refused, and
 * Responses bodies are rewritten for plan usage. A 401 refreshes once and retries once.
 */
export function createChatGptFetch({
  tokens,
  fetch: inner,
}: ChatGptFetchOptions): typeof globalThis.fetch {
  const send = noRedirectFetch(inner)

  return (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const isResponses =
      (init.method ?? 'GET').toUpperCase() === 'POST' && url.pathname.endsWith('/responses')
    const body = isResponses ? rewriteBody(init.body) : init.body

    const attempt = (bearer: string) => {
      const headers = new Headers(init.headers)
      for (const h of DROPPED_HEADERS) headers.delete(h)
      headers.set('authorization', `Bearer ${bearer}`)
      return send(input, { ...init, headers, ...(body === undefined ? {} : { body }) })
    }

    const bearer = await tokens.getAccessToken()
    let res = await attempt(bearer)
    if (res.status === 401) {
      void res.body?.cancel().catch(() => {})
      const renewed = await tokens.refreshAfterRejection(bearer)
      res = await attempt(renewed)
    }
    if (!res.ok) throw await failureFrom(res)
    return isResponses ? guardStream(res) : res
  }) as typeof globalThis.fetch
}
