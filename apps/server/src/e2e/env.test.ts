import { describe, expect, it } from 'vitest'
import { assertE2eEnv } from './env.ts'

describe('assertE2eEnv', () => {
  it('accepts FAIRE_E2E=1', () => {
    expect(() => assertE2eEnv({ FAIRE_E2E: '1' })).not.toThrow()
  })

  it.each([undefined, '', '0', 'true', 'yes'])('refuses FAIRE_E2E=%j', (value) => {
    expect(() => assertE2eEnv({ FAIRE_E2E: value })).toThrow(/FAIRE_E2E=1/)
  })
})
