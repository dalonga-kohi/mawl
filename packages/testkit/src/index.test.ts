import { describe, expect, it } from 'vitest'
import * as testkit from './index'

describe('@mawl/testkit', () => {
  it('exposes its package name', () => {
    expect(testkit.packageName).toBe('@mawl/testkit')
  })

  it('exports the public helpers', () => {
    const helpers = [
      testkit.fakeModel,
      testkit.seq,
      testkit.fixedClock,
      testkit.seededRandom,
      testkit.startPostgres,
      testkit.isDockerAvailable,
      testkit.withPostgres,
    ]
    expect(helpers.every((h) => typeof h === 'function')).toBe(true)
  })
})
