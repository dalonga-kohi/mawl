import { ProviderCredentialInput } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { resolveBaseUrl } from './descriptors.ts'

describe('base url normalisation', () => {
  it.each([
    'https://llm.example.com/v1/',
    'https://llm.example.com/v1///',
    'https://llm.example.com/',
    'http://[::1]:8080/v1/',
    'https://llm.example.com/v1',
  ])('contract and resolveBaseUrl agree on %s', (baseUrl) => {
    const parsed = ProviderCredentialInput.parse({
      provider: 'openai_compatible',
      label: 'k',
      baseUrl,
    })
    expect(parsed.baseUrl).toBe(resolveBaseUrl('openai_compatible', baseUrl))
  })
})
