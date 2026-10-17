import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@faire/client', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@faire/client')
  })
})
