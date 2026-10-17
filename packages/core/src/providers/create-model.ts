import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModelV4 } from '@ai-sdk/provider'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import { createOllama } from 'ollama-ai-provider-v2'
import { PROVIDER_DESCRIPTORS, type ProviderConnection, resolveBaseUrl } from './descriptors.ts'

export interface CreateLanguageModelOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
}

/**
 * Builds the AI SDK model for a decrypted credential. OpenAI uses the Responses API (the SDK
 * default); openai_compatible uses chat completions, the only dialect such servers share.
 * Keys never leave the returned model object except as the provider's auth header.
 */
export function createLanguageModel(
  conn: ProviderConnection,
  modelId: string,
  { fetch }: CreateLanguageModelOptions = {},
): LanguageModelV4 {
  const baseURL = resolveBaseUrl(conn.kind, conn.baseUrl)
  const apiKey = conn.secret ?? undefined
  // Optional settings are spread so they are absent, not undefined (exactOptionalPropertyTypes).
  const withFetch = fetch ? { fetch } : {}
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
