import type { ProviderDescriptor, ProviderKind } from '@faire/contracts'

const tools = {
  supportsTools: true,
  supportsCaching: false,
  supportsContextEditing: false,
  supportsCompaction: false,
}

/**
 * Static facts about each provider kind. The run engine reads `capabilities` to decide which
 * context-management features it may use; the app reads the rest to render the add form.
 * The Ollama default is the host's loopback: inside Docker the owner sets host.docker.internal.
 */
export const PROVIDER_DESCRIPTORS: Record<ProviderKind, ProviderDescriptor> = {
  anthropic: {
    kind: 'anthropic',
    label: 'Anthropic',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    capabilities: {
      supportsTools: true,
      supportsCaching: true,
      supportsContextEditing: true,
      supportsCompaction: true,
    },
  },
  openai: {
    kind: 'openai',
    label: 'OpenAI',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: { ...tools, supportsCaching: true },
  },
  openrouter: {
    kind: 'openrouter',
    label: 'OpenRouter',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    capabilities: { ...tools, supportsCaching: true },
  },
  ollama: {
    kind: 'ollama',
    label: 'Ollama',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'http://localhost:11434',
    capabilities: { ...tools },
  },
  openai_compatible: {
    kind: 'openai_compatible',
    label: 'OpenAI-compatible',
    keyRequired: false,
    baseUrlRequired: true,
    defaultBaseUrl: null,
    capabilities: { ...tools },
  },
  // Credentials come from the OAuth flow, never from a form; the base url is fixed to OpenAI.
  openai_chatgpt: {
    kind: 'openai_chatgpt',
    label: 'ChatGPT plan',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: { ...tools },
  },
}

/** Descriptors in the order of the ProviderKind enum. */
export function listProviderDescriptors(): ProviderDescriptor[] {
  return Object.values(PROVIDER_DESCRIPTORS)
}

/** What a stored credential carries once decrypted. Never log or serialise this. */
export interface ProviderConnection {
  kind: ProviderKind
  baseUrl: string | null
  secret: string | null
}

/** The credential's base url, or the kind's default, without trailing slashes. */
export function resolveBaseUrl(kind: ProviderKind, baseUrl: string | null): string {
  // The ChatGPT plan endpoint is fixed: a stored url must never receive plan tokens.
  const base =
    kind === 'openai_chatgpt'
      ? PROVIDER_DESCRIPTORS[kind].defaultBaseUrl
      : (baseUrl ?? PROVIDER_DESCRIPTORS[kind].defaultBaseUrl)
  if (base === null) throw new Error(`${kind} needs a base url`)
  return base.replace(/\/+$/, '')
}
