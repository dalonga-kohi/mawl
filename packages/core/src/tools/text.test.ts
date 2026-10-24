import { describe, expect, it } from 'vitest'
import { cut, storable, storableJson } from './text.ts'

describe('cut', () => {
  it('leaves short text alone and cuts long text to the limit', () => {
    expect(cut('abc', 5)).toBe('abc')
    expect(cut('abcdef', 3)).toBe('abc')
  })

  it('never ends on half of a surrogate pair', () => {
    expect(cut('ab😀cd', 3)).toBe('ab')
    expect(cut('ab😀cd', 4)).toBe('ab😀')
  })
})

describe('storable', () => {
  it('removes NUL and replaces lone surrogates, keeping real pairs', () => {
    expect(storable('a\u0000b')).toBe('ab')
    expect(storable('x\uD83Dy')).toBe('x�y')
    expect(storable('x\uDE00y')).toBe('x�y')
    expect(storable('ok 😀')).toBe('ok 😀')
  })

  it('applies to every string of a JSON value, keys included', () => {
    expect(storableJson({ 'k\u0000': ['v\u0000', { n: 1, s: '\uD800' }] })).toEqual({
      k: ['v', { n: 1, s: '�' }],
    })
  })
})
