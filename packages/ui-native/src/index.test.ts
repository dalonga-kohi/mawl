import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/ui-native', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/ui-native')
  })
})
