import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/core', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/core')
  })
})
