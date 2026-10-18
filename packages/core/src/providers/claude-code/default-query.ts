import type { ClaudeQueryFn } from './types.ts'

/**
 * The SDK's `query`, loaded on first use so no other code path pays for (or can trip over) the
 * package. The binary it runs is the one Anthropic publishes, unmodified.
 */
export const defaultClaudeQuery: ClaudeQueryFn = (params) => {
  let inner: ReturnType<ClaudeQueryFn> | undefined
  let closed = false
  return {
    close() {
      closed = true
      inner?.close?.()
    },
    async *[Symbol.asyncIterator]() {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      if (closed) return
      inner = sdk.query({ prompt: params.prompt, options: params.options })
      yield* inner
    },
  }
}
