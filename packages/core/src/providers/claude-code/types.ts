import type { Options } from '@anthropic-ai/claude-agent-sdk'

/** The subset of the SDK's query options the adapter sets. Type-only: nothing loads the SDK. */
export type ClaudeQueryOptions = Pick<
  Options,
  | 'model'
  | 'systemPrompt'
  | 'tools'
  | 'settingSources'
  | 'persistSession'
  | 'maxTurns'
  | 'includePartialMessages'
  | 'permissionMode'
  | 'strictMcpConfig'
  | 'abortController'
  | 'env'
  | 'cwd'
  | 'pathToClaudeCodeExecutable'
>

export interface ClaudeQueryParams {
  prompt: string
  options: ClaudeQueryOptions
}

/** What the adapter needs from the SDK's `Query`: an async stream of messages it can close. */
export interface ClaudeQueryHandle extends AsyncIterable<unknown> {
  close?(): void
}

/** The SDK's `query`. Injected so tests never spawn the binary. */
export type ClaudeQueryFn = (params: ClaudeQueryParams) => ClaudeQueryHandle
