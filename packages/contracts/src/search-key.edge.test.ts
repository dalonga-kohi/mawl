import { describe, expect, it } from 'vitest'
import { SearchKeyClear, SearchKeyInput } from './entities.ts'

const parse = (apiKey: unknown, provider: unknown = 'tavily') =>
  SearchKeyInput.safeParse({ provider, apiKey })

describe('SearchKeyInput edge cases', () => {
  it('trims surrounding whitespace before checking', () => {
    expect(parse('  tvly-abc \n')).toMatchObject({ success: true, data: { apiKey: 'tvly-abc' } })
  })

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['an inner space', 'tvly abc'],
    ['an inner tab', 'tvly\tabc'],
    ['CR LF injection', 'tvly-abc\r\nx-evil: 1'],
    ['a NUL', 'tvly\u0000abc'],
    ['non-ASCII', 'tvly-ключ'],
    ['an emoji', 'tvly-😀'],
    ['a full-width letter', 'tvly-ａ'],
    ['a DEL control', 'tvly\u007fabc'],
    ['a non-breaking space inside', 'tvly abc'],
    ['513 characters', 'a'.repeat(513)],
  ])('rejects %s', (_n, key) => {
    expect(parse(key).success).toBe(false)
  })

  it('accepts exactly 512 printable characters and all printable ASCII punctuation', () => {
    expect(parse('a'.repeat(512)).success).toBe(true)
    expect(parse('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~09azAZ').success).toBe(true)
  })

  it.each([
    ['a number', 12345],
    ['null', null],
    ['undefined', undefined],
    ['an array', ['a']],
  ])('rejects %s as the key', (_n, key) => {
    expect(parse(key).success).toBe(false)
  })

  it('rejects an unknown provider, extra fields and a missing provider', () => {
    expect(parse('k', 'google').success).toBe(false)
    expect(parse('k', 'ddgs').success).toBe(false)
    expect(SearchKeyInput.safeParse({ provider: 'brave', apiKey: 'k', extra: 1 }).success).toBe(
      false,
    )
    expect(SearchKeyInput.safeParse({ apiKey: 'k' }).success).toBe(false)
  })

  it('does not echo the rejected key in the error', () => {
    const r = parse('secret key with spaces')
    expect(r.success).toBe(false)
    if (!r.success) expect(JSON.stringify(r.error.issues)).not.toContain('secret key')
  })
})

describe('SearchKeyClear edge cases', () => {
  it('accepts the two keyed providers only, strictly', () => {
    expect(SearchKeyClear.safeParse({ provider: 'tavily' }).success).toBe(true)
    expect(SearchKeyClear.safeParse({ provider: 'brave' }).success).toBe(true)
    expect(SearchKeyClear.safeParse({ provider: 'ddgs' }).success).toBe(false)
    expect(SearchKeyClear.safeParse({ provider: 'brave', apiKey: 'k' }).success).toBe(false)
    expect(SearchKeyClear.safeParse({}).success).toBe(false)
  })
})
