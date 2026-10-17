import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@faire/contracts', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@faire/contracts')
  })
})
