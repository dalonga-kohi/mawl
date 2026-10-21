import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/contracts', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/contracts')
  })
})
