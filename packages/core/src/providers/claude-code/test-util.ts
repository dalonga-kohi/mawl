import type { ClaudeQueryFn, ClaudeQueryParams } from './types.ts'

/** Raw SDK messages as the binary emits them, trimmed to what the adapter reads. */
export const msg = {
  start: (id = 'msg_1', model = 'claude-sonnet-test') => ({
    type: 'stream_event',
    event: { type: 'message_start', message: { id, model } },
  }),
  blockStart: (index: number, type: 'text' | 'thinking' = 'text') => ({
    type: 'stream_event',
    event: { type: 'content_block_start', index, content_block: { type } },
  }),
  textDelta: (index: number, text: string) => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index, delta: { type: 'text_delta', text } },
  }),
  thinkingDelta: (index: number, thinking: string) => ({
    type: 'stream_event',
    event: { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } },
  }),
  blockStop: (index: number) => ({
    type: 'stream_event',
    event: { type: 'content_block_stop', index },
  }),
  assistant: (text: string, error?: string) => ({
    type: 'assistant',
    message: { id: 'msg_1', model: 'claude-sonnet-test', content: [{ type: 'text', text }] },
    ...(error ? { error } : {}),
  }),
  rateLimit: (status: 'allowed' | 'allowed_warning' | 'rejected', resetsAt?: number) => ({
    type: 'rate_limit_event',
    rate_limit_info: { status, ...(resetsAt === undefined ? {} : { resetsAt }) },
  }),
  success: (
    over: Partial<{
      stop_reason: string | null
      is_error: boolean
      usage: Record<string, number>
    }> = {},
  ) => ({
    type: 'result',
    subtype: 'success',
    is_error: over.is_error ?? false,
    stop_reason: over.stop_reason === undefined ? 'end_turn' : over.stop_reason,
    result: 'ignored',
    usage: over.usage ?? {
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 100,
      cache_creation_input_tokens: 20,
    },
  }),
  failure: (subtype = 'error_during_execution', errors: string[] = ['boom sk-ant-LEAK']) => ({
    type: 'result',
    subtype,
    is_error: true,
    stop_reason: null,
    errors,
    usage: { input_tokens: 0, output_tokens: 0 },
  }),
}

export interface FakeQuery {
  query: ClaudeQueryFn
  calls: ClaudeQueryParams[]
  closed: () => number
}

/**
 * A scripted stand-in for the SDK's `query`: yields the messages, or throws the given error after
 * them. Honors the abort controller like the real one (ends the iteration with an AbortError).
 */
export function fakeQuery(
  messages: unknown[],
  { throwAfter, hang }: { throwAfter?: unknown; hang?: boolean } = {},
): FakeQuery {
  const calls: ClaudeQueryParams[] = []
  let closed = 0
  const query: ClaudeQueryFn = (params) => {
    calls.push(params)
    const signal = params.options.abortController?.signal
    return {
      close: () => {
        closed++
      },
      async *[Symbol.asyncIterator]() {
        for (const m of messages) {
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
          yield m
        }
        if (hang) {
          await new Promise<void>((_, reject) => {
            signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            )
          })
        }
        if (throwAfter !== undefined) throw throwAfter
      },
    }
  }
  return { query, calls, closed: () => closed }
}
