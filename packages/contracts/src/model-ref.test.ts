import { describe, expect, it } from 'vitest'
import { id } from './fixtures'
import { formatModelRef, ModelRef, parseModelRef } from './model-ref'

const cred = id('cred')

describe('parseModelRef', () => {
  it('splits at the first colon into credential id and model id', () => {
    expect(parseModelRef(`${cred}:claude-sonnet-4`)).toEqual({
      credentialId: cred,
      modelId: 'claude-sonnet-4',
    })
  })

  it('keeps colons and slashes in the model id', () => {
    expect(parseModelRef(`${cred}:meta/llama-3:70b-instruct`)).toEqual({
      credentialId: cred,
      modelId: 'meta/llama-3:70b-instruct',
    })
  })

  it.each([
    ['empty string', ''],
    ['no colon', cred],
    ['empty model id', `${cred}:`],
    ['empty credential id', ':gpt-5'],
    ['legacy provider prefix', 'anthropic:claude-sonnet'],
    ['wrong id kind', `${id('prof')}:gpt-5`],
    ['whitespace model id', `${cred}:   `],
  ])('returns null for %s', (_name, value) => {
    expect(parseModelRef(value)).toBeNull()
  })

  it('returns null for non-strings', () => {
    expect(parseModelRef(undefined as unknown as string)).toBeNull()
  })
})

describe('formatModelRef', () => {
  it('round-trips with parseModelRef', () => {
    const ref = parseModelRef(`${cred}:a:b/c`)
    expect(ref).not.toBeNull()
    if (ref) expect(formatModelRef(ref)).toBe(`${cred}:a:b/c`)
  })
})

describe('ModelRef schema', () => {
  it('accepts a valid ref and rejects a bad credential id', () => {
    expect(ModelRef.safeParse({ credentialId: cred, modelId: 'x' }).success).toBe(true)
    expect(ModelRef.safeParse({ credentialId: 'nope', modelId: 'x' }).success).toBe(false)
    expect(ModelRef.safeParse({ credentialId: cred, modelId: '' }).success).toBe(false)
  })
})
