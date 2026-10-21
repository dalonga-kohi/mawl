import { ProviderFailureReason } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { extractErrorCode, mapResponsesError } from './errors.ts'

describe('ProviderFailureError', () => {
  it('carries only the closed reason and an optional retryAfter', () => {
    const e = new ProviderFailureError('plan_limit_reached', { retryAfter: 30 })
    expect(e.reason).toBe('plan_limit_reached')
    expect(e.retryAfter).toBe(30)
    expect(ProviderFailureReason.safeParse(e.reason).success).toBe(true)
    expect(e.message).not.toMatch(/token|secret/i)
  })

  it('omits retryAfter when absent', () => {
    expect(new ProviderFailureError('config_error').retryAfter).toBeUndefined()
  })
})

describe('mapResponsesError', () => {
  it.each([
    ['subscription_sharing_usage_limit_exceeded', 429, 'plan_limit_reached'],
    ['subscription_sharing_user_not_eligible', 403, 'not_eligible'],
    ['subscription_sharing_usage_unavailable', 503, 'temporarily_unavailable'],
    ['subscription_sharing_user_unavailable', 503, 'temporarily_unavailable'],
    ['subscription_sharing_unsupported_capability', 400, 'unsupported_capability'],
    ['subscription_sharing_route_not_supported', 403, 'config_error'],
    ['chatpass_v2_scope_not_authorized', 403, 'config_error'],
    ['chatpass_v2_invalid_authorization_context', 403, 'config_error'],
  ] as const)('maps %s to %s', (code, status, reason) => {
    expect(mapResponsesError(code, status)).toBe(reason)
    // The code wins over a misleading status.
    expect(mapResponsesError(code, 500)).toBe(reason)
  })

  it('falls back to the http status when the code is unknown or missing', () => {
    expect(mapResponsesError(undefined, 429)).toBe('plan_limit_reached')
    expect(mapResponsesError(undefined, 403)).toBe('not_eligible')
    expect(mapResponsesError(undefined, 503)).toBe('temporarily_unavailable')
    expect(mapResponsesError('mystery', 502)).toBe('temporarily_unavailable')
    expect(mapResponsesError(undefined, 400)).toBe('unsupported_capability')
    expect(mapResponsesError(undefined, 418)).toBe('provider_error')
  })
})

describe('extractErrorCode', () => {
  it('reads error.code, a top-level code, or an oauth error string', () => {
    expect(extractErrorCode({ error: { code: 'a_b' } })).toBe('a_b')
    expect(extractErrorCode({ code: 'a_b' })).toBe('a_b')
    expect(extractErrorCode({ error: 'invalid_grant' })).toBe('invalid_grant')
  })

  it('ignores anything that is not a plain code, so provider text never becomes a reason', () => {
    expect(extractErrorCode({ error: { code: 'Your key sk-123 is bad' } })).toBeUndefined()
    expect(extractErrorCode({ detail: 'x' })).toBeUndefined()
    expect(extractErrorCode(null)).toBeUndefined()
    expect(extractErrorCode('string')).toBeUndefined()
  })
})
