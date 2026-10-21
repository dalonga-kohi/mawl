import { ProviderDescriptor, ProviderKind } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { listProviderDescriptors, PROVIDER_DESCRIPTORS } from './descriptors.ts'

describe('PROVIDER_DESCRIPTORS', () => {
  it('has a valid descriptor for every provider kind, keyed by its own kind', () => {
    for (const kind of ProviderKind.options) {
      const d = PROVIDER_DESCRIPTORS[kind]
      expect(d.kind).toBe(kind)
      expect(ProviderDescriptor.safeParse(d).success).toBe(true)
    }
    expect(listProviderDescriptors().map((d) => d.kind)).toEqual(ProviderKind.options)
  })

  it('flags capabilities per provider', () => {
    const caps = (k: ProviderKind) => PROVIDER_DESCRIPTORS[k].capabilities
    expect(caps('anthropic')).toEqual({
      supportsTools: true,
      supportsCaching: true,
      supportsContextEditing: true,
      supportsCompaction: true,
    })
    for (const k of ['openai', 'openrouter'] as const) {
      expect(caps(k)).toEqual({
        supportsTools: true,
        supportsCaching: true,
        supportsContextEditing: false,
        supportsCompaction: false,
      })
    }
    for (const k of ['ollama', 'openai_compatible'] as const) {
      expect(caps(k)).toEqual({
        supportsTools: true,
        supportsCaching: false,
        supportsContextEditing: false,
        supportsCompaction: false,
      })
    }
  })

  it('describes Sign in with ChatGPT: no key, a fixed OpenAI base url, tools but no caching', () => {
    expect(PROVIDER_DESCRIPTORS.openai_chatgpt).toMatchObject({
      keyRequired: false,
      baseUrlRequired: false,
      defaultBaseUrl: 'https://api.openai.com/v1',
      capabilities: {
        supportsTools: true,
        supportsCaching: false,
        supportsContextEditing: false,
        supportsCompaction: false,
      },
    })
  })

  it('describes the Claude subscription: no key, no base url, text only for now', () => {
    expect(PROVIDER_DESCRIPTORS.anthropic_claude_code).toMatchObject({
      keyRequired: false,
      baseUrlRequired: false,
      defaultBaseUrl: null,
      capabilities: {
        supportsTools: false,
        supportsCaching: false,
        supportsContextEditing: false,
        supportsCompaction: false,
      },
    })
  })

  it('declares which providers need a key or a base url, and the defaults', () => {
    expect(PROVIDER_DESCRIPTORS.anthropic).toMatchObject({
      keyRequired: true,
      baseUrlRequired: false,
      defaultBaseUrl: 'https://api.anthropic.com/v1',
    })
    expect(PROVIDER_DESCRIPTORS.openai.defaultBaseUrl).toBe('https://api.openai.com/v1')
    expect(PROVIDER_DESCRIPTORS.openrouter.defaultBaseUrl).toBe('https://openrouter.ai/api/v1')
    expect(PROVIDER_DESCRIPTORS.ollama).toMatchObject({
      keyRequired: false,
      baseUrlRequired: false,
      defaultBaseUrl: 'http://localhost:11434',
    })
    expect(PROVIDER_DESCRIPTORS.openai_compatible).toMatchObject({
      keyRequired: false,
      baseUrlRequired: true,
      defaultBaseUrl: null,
    })
  })
})
