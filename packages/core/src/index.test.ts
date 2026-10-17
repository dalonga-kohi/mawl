import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@faire/core', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@faire/core')
  })
})
