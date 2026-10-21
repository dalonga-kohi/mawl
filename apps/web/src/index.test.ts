import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/web', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/web')
  })
})
