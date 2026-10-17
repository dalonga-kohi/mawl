import { describe, expect, it } from 'vitest'
import * as testkit from './index'

describe('@faire/testkit', () => {
  it('exposes its package name', () => {
    expect(testkit.packageName).toBe('@faire/testkit')
  })

  it('exports the public helpers', () => {
    const helpers = [
      testkit.fakeModel,
      testkit.seq,
      testkit.fixedClock,
      testkit.seededRandom,
      testkit.startPostgres,
      testkit.isDockerAvailable,
      testkit.describeWithPostgres,
    ]
    expect(helpers.every((h) => typeof h === 'function')).toBe(true)
  })
})
