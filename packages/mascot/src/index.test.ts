import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/mascot', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/mascot')
  })
})
