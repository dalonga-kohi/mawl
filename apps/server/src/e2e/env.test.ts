import { describe, expect, it } from 'vitest'
import { assertE2eEnv } from './env.ts'

describe('assertE2eEnv', () => {
  it('accepts MAWL_E2E=1', () => {
    expect(() => assertE2eEnv({ MAWL_E2E: '1' })).not.toThrow()
  })

  it.each([undefined, '', '0', 'true', 'yes'])('refuses MAWL_E2E=%j', (value) => {
    expect(() => assertE2eEnv({ MAWL_E2E: value })).toThrow(/MAWL_E2E=1/)
  })
})
