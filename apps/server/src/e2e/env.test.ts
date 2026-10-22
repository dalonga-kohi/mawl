import { describe, expect, it } from 'vitest'
import { assertE2eEnv, e2eOwnerToken } from './env.ts'

describe('e2eOwnerToken', () => {
  const token = 'mawl-e2e-owner-token_0123456789abcdefgh'
  it('takes MAWL_OWNER_TOKEN, which the Playwright config sets', () => {
    expect(e2eOwnerToken({ MAWL_OWNER_TOKEN: token })).toBe(token)
  })
  it.each([undefined, '', 'short'])('refuses MAWL_OWNER_TOKEN=%j without echoing it', (value) => {
    expect(() => e2eOwnerToken({ MAWL_OWNER_TOKEN: value })).toThrow(/MAWL_OWNER_TOKEN/)
  })
})

describe('assertE2eEnv', () => {
  it('accepts MAWL_E2E=1', () => {
    expect(() => assertE2eEnv({ MAWL_E2E: '1' })).not.toThrow()
  })

  it.each([undefined, '', '0', 'true', 'yes'])('refuses MAWL_E2E=%j', (value) => {
    expect(() => assertE2eEnv({ MAWL_E2E: value })).toThrow(/MAWL_E2E=1/)
  })
})
