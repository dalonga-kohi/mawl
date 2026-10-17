import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@faire/ui-native', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@faire/ui-native')
  })
})
