import { isContractProcedure } from '@orpc/contract'
import { describe, expect, it } from 'vitest'
import { ProviderCredentialInput, ProviderDescriptor, ProviderTestResult } from './entities'
import { ProviderKind } from './enums'
import { contract } from './router'

const parse = (v: unknown) => ProviderCredentialInput.safeParse(v)

describe('ProviderCredentialInput', () => {
  it.each(['anthropic', 'openai', 'openrouter'] as const)(
    'requires a secret for %s',
    (provider) => {
      expect(parse({ provider, label: 'k' }).success).toBe(false)
      expect(parse({ provider, label: 'k', secret: 'sk-1' }).success).toBe(true)
    },
  )

  it.each(['ollama', 'openai_compatible'] as const)(
    'makes the secret optional for %s',
    (provider) => {
      const base = { provider, label: 'k', baseUrl: 'http://localhost:11434' }
      expect(parse(base).success).toBe(true)
      expect(parse({ ...base, secret: 'abc' }).success).toBe(true)
    },
  )

  it('still rejects an empty secret', () => {
    expect(parse({ provider: 'ollama', label: 'k', secret: '' }).success).toBe(false)
  })

  it('requires baseUrl for openai_compatible only', () => {
    expect(parse({ provider: 'openai_compatible', label: 'k', secret: 'x' }).success).toBe(false)
    expect(parse({ provider: 'openai', label: 'k', secret: 'x' }).success).toBe(true)
  })

  it('allows only http and https base urls', () => {
    const ok = (baseUrl: string) =>
      parse({ provider: 'openai_compatible', label: 'k', secret: 'x', baseUrl }).success
    expect(ok('https://example.com/v1')).toBe(true)
    expect(ok('http://localhost:8080')).toBe(true)
    expect(ok('file:///etc/passwd')).toBe(false)
    expect(ok('ftp://example.com')).toBe(false)
    expect(ok('javascript:alert(1)')).toBe(false)
  })

  it('rejects a base url with embedded credentials', () => {
    const r = parse({
      provider: 'openai_compatible',
      label: 'k',
      baseUrl: 'https://user:pw@example.com/v1',
    })
    expect(r.success).toBe(false)
  })

  it.each([
    'https://example.com/v1?api_key=abc',
    'https://example.com/v1?',
    'https://example.com/v1#frag',
    'https://example.com/v1#',
  ])('rejects a base url with a query or fragment: %s', (baseUrl) => {
    expect(parse({ provider: 'openai_compatible', label: 'k', baseUrl }).success).toBe(false)
  })

  it.each([
    ['https://example.com/v1/', 'https://example.com/v1'],
    ['https://example.com/v1///', 'https://example.com/v1'],
    ['https://example.com/', 'https://example.com'],
    ['https://example.com/v1', 'https://example.com/v1'],
  ])('normalises the trailing slash of %s to %s', (baseUrl, expected) => {
    const r = parse({ provider: 'openai_compatible', label: 'k', baseUrl })
    expect(r.success && r.data.baseUrl).toBe(expected)
  })

  it('caps label at 80 and secret at 4096 characters', () => {
    const base = { provider: 'openai', label: 'k', secret: 'x' }
    expect(parse({ ...base, label: 'a'.repeat(80) }).success).toBe(true)
    expect(parse({ ...base, label: 'a'.repeat(81) }).success).toBe(false)
    expect(parse({ ...base, secret: 'a'.repeat(4096) }).success).toBe(true)
    expect(parse({ ...base, secret: 'a'.repeat(4097) }).success).toBe(false)
  })

  it('rejects unknown keys', () => {
    expect(parse({ provider: 'openai', label: 'k', secret: 'x', extra: 1 }).success).toBe(false)
  })
})

describe('ProviderTestResult', () => {
  it('accepts ok with latency and failure with a closed reason', () => {
    expect(ProviderTestResult.safeParse({ ok: true, latencyMs: 12 }).success).toBe(true)
    for (const reason of ['invalid_key', 'unreachable', 'rate_limited', 'unexpected_response']) {
      expect(ProviderTestResult.safeParse({ ok: false, reason }).success).toBe(true)
    }
  })

  it('never carries free text', () => {
    expect(ProviderTestResult.safeParse({ ok: false, reason: 'because sk-123' }).success).toBe(
      false,
    )
    expect(
      ProviderTestResult.safeParse({ ok: false, reason: 'invalid_key', message: 'sk-123' }).success,
    ).toBe(false)
    expect(ProviderTestResult.safeParse({ ok: true, latencyMs: 1, message: 'x' }).success).toBe(
      false,
    )
  })
})

describe('ProviderDescriptor', () => {
  const descriptor = {
    kind: 'ollama',
    label: 'Ollama',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'http://localhost:11434',
    capabilities: {
      supportsTools: true,
      supportsCaching: false,
      supportsContextEditing: false,
      supportsCompaction: false,
    },
  }

  it('parses a descriptor and rejects extra keys', () => {
    expect(ProviderDescriptor.safeParse(descriptor).success).toBe(true)
    expect(ProviderDescriptor.safeParse({ ...descriptor, secret: 'x' }).success).toBe(false)
    expect(ProviderDescriptor.safeParse({ ...descriptor, kind: 'nope' }).success).toBe(false)
    expect(ProviderDescriptor.safeParse({ ...descriptor, defaultBaseUrl: null }).success).toBe(true)
  })
})

describe('providers router contract', () => {
  it('exposes catalog, list, create, delete and test', () => {
    const names = Object.entries(contract.providers)
      .filter(([, v]) => isContractProcedure(v))
      .map(([k]) => k)
      .sort()
    expect(names).toEqual(['catalog', 'create', 'delete', 'list', 'test'])
  })

  it('test declares CREDENTIAL_UNREADABLE so a changed master key is distinguishable', () => {
    expect(Object.keys(contract.providers.test['~orpc'].errorMap)).toContain(
      'CREDENTIAL_UNREADABLE',
    )
  })

  it('delete and test declare NOT_FOUND', () => {
    expect(Object.keys(contract.providers.delete['~orpc'].errorMap)).toContain('NOT_FOUND')
    expect(Object.keys(contract.providers.test['~orpc'].errorMap)).toContain('NOT_FOUND')
  })

  it('test accepts a stored id or a new credential', async () => {
    const schema = contract.providers.test['~orpc'].inputSchema
    const validate = async (v: unknown) => schema?.['~standard'].validate(v)
    expect(await validate({ id: 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' })).not.toHaveProperty('issues')
    expect(await validate({ provider: 'openai', label: 'k', secret: 'x' })).not.toHaveProperty(
      'issues',
    )
    expect(await validate({ provider: 'openai', label: 'k' })).toHaveProperty('issues')
  })

  it('covers every provider kind in the enum', () => {
    expect(ProviderKind.options).toHaveLength(6)
  })
})
