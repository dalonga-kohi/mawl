import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { PLACEHOLDER_API_KEY } from './chatgpt/constants.ts'
import { createChatGptFetch } from './chatgpt/fetch.ts'
import type { TokenManager } from './chatgpt/token-manager.ts'
import { type ClaudeCodeModelOptions, createClaudeCodeModel } from './claude-code/model.ts'
import type { ClaudeQueryFn } from './claude-code/types.ts'
import { PROVIDER_DESCRIPTORS, type ProviderConnection, resolveBaseUrl } from './descriptors.ts'
import { noRedirectFetch } from './no-redirect-fetch.ts'

export interface CreateLanguageModelOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
  /** Required for openai_chatgpt: supplies a fresh bearer per request. Never a stored secret. */
  chatgpt?: { tokens: TokenManager }
  /** anthropic_claude_code: where the binary and its login live. Neither is a secret. */
  claudeCode?: {
    configDir?: string | undefined
    pathToClaudeCodeExecutable?: string | undefined
    /** Injected in tests so the binary is never spawned. */
    query?: ClaudeQueryFn
    /** Injected in tests so `claude auth status` is never spawned. */
    checkLogin?: NonNullable<ClaudeCodeModelOptions['checkLogin']>
  }
}

/**
 * Builds the AI SDK model for a decrypted credential. OpenAI uses the Responses API (the SDK
 * default); openai_compatible uses chat completions, the only dialect such servers share.
 * Keys never leave the returned model object except as the provider's auth header.
 */
export function createLanguageModel(
  conn: ProviderConnection,
  modelId: string,
  { fetch, chatgpt, claudeCode }: CreateLanguageModelOptions = {},
): LanguageModelV4 {
  if (conn.kind === 'openai_chatgpt') {
    if (!chatgpt) throw new Error('openai_chatgpt needs Sign in with ChatGPT tokens')
    // The base url is fixed: a stored one must never redirect plan tokens to another host.
    return createOpenAI({
      baseURL: resolveBaseUrl(conn.kind, null),
      // The SDK insists on a key; the wrapper replaces the header on every call.
      apiKey: PLACEHOLDER_API_KEY,
      fetch: createChatGptFetch({ tokens: chatgpt.tokens, ...(fetch ? { fetch } : {}) }),
    }).responses(modelId)
  }
  if (conn.kind === 'anthropic_claude_code') {
    // The login lives in the binary's own config dir. A stored secret or base url is ignored.
    // Only these fields are passed on, whatever else the caller's object carries.
    return createClaudeCodeModel({
      modelId,
      configDir: claudeCode?.configDir,
      pathToClaudeCodeExecutable: claudeCode?.pathToClaudeCodeExecutable,
      ...(claudeCode?.query ? { query: claudeCode.query } : {}),
      ...(claudeCode?.checkLogin ? { checkLogin: claudeCode.checkLogin } : {}),
    })
  }
  const baseURL = resolveBaseUrl(conn.kind, conn.baseUrl)
  const apiKey = conn.secret ?? undefined
  // Always our wrapper, never the SDK's default fetch: a redirect must not carry the key elsewhere.
  const withFetch = { fetch: noRedirectFetch(fetch) }
  // Optional settings are spread so they are absent, not undefined (exactOptionalPropertyTypes).
  const withKey = apiKey ? { apiKey } : {}
  // These SDKs fall back to an env var when no key is passed; never let that happen.
  if (PROVIDER_DESCRIPTORS[conn.kind].keyRequired && !apiKey) {
    throw new Error(`${conn.kind} needs an API key`)
  }
  switch (conn.kind) {
    case 'anthropic':
      return createAnthropic({ baseURL, ...withKey, ...withFetch })(modelId)
    case 'openai':
      return createOpenAI({ baseURL, ...withKey, ...withFetch })(modelId)
    case 'openrouter':
      return createOpenRouter({ baseURL, ...withKey, ...withFetch, compatibility: 'strict' })(
        modelId,
      )
    case 'ollama':
      return createOllama({
        baseURL: `${baseURL}/api`,
        ...(apiKey ? { headers: { authorization: `Bearer ${apiKey}` } } : {}),
        ...withFetch,
      })(modelId)
    case 'openai_compatible':
      return createOpenAICompatible({
        name: 'openai-compatible',
        baseURL,
        ...withKey,
        ...withFetch,
      })(modelId)
  }
}
