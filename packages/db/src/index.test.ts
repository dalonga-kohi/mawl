import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@faire/db', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@faire/db')
  })
})
