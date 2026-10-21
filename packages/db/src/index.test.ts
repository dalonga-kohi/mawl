import { describe, expect, it } from 'vitest'
import { packageName } from './index'

describe('@mawl/db', () => {
  it('exposes its package name', () => {
    expect(packageName).toBe('@mawl/db')
  })
})
