import { describe, expect, it } from 'vitest'
import { cn } from './cn.ts'

describe('cn', () => {
  it('joins class names and skips falsy parts', () => {
    expect(cn('a', false, null, undefined, 'b')).toBe('a b')
  })

  it('keeps a Mawl type size next to a Mawl text color (they are different groups)', () => {
    for (const size of ['display', 'title', 'heading', 'body', 'small', 'micro']) {
      expect(cn(`text-${size}`, 'text-text-2')).toBe(`text-${size} text-text-2`)
    }
  })

  it('lets a later size or color win over an earlier one', () => {
    expect(cn('text-small', 'text-body')).toBe('text-body')
    expect(cn('text-text-2', 'text-accent-ink')).toBe('text-accent-ink')
    expect(cn('bg-surface', 'bg-accent-fill')).toBe('bg-accent-fill')
  })

  it('merges the Mawl radii and shadows', () => {
    expect(cn('rounded-pill', 'rounded-card')).toBe('rounded-card')
    expect(cn('rounded-dialog', 'rounded-xs')).toBe('rounded-xs')
    expect(cn('shadow-1', 'shadow-2')).toBe('shadow-2')
  })

  it('lets a caller size override a component size', () => {
    expect(cn('size-9 pointer-coarse:size-11', 'size-12')).toBe('pointer-coarse:size-11 size-12')
  })
})
