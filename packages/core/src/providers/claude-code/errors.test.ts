import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { failureForAssistantError, failureForRateLimit } from './errors.ts'

describe('failureForAssistantError', () => {
  it.each([
    ['rate_limit', 'plan_limit_reached'],
    ['authentication_failed', 'reauth_required'],
    ['oauth_org_not_allowed', 'reauth_required'],
    ['verification_required', 'reauth_required'],
    ['account_on_hold', 'not_eligible'],
    ['billing_error', 'not_eligible'],
    ['overloaded', 'temporarily_unavailable'],
    ['server_error', 'temporarily_unavailable'],
    ['model_not_found', 'config_error'],
    ['invalid_request', 'config_error'],
    ['unknown', 'provider_error'],
    ['max_output_tokens', 'provider_error'],
    ['cloud_credential_error', 'provider_error'],
    ['something_new_next_year', 'provider_error'],
  ])('maps %s to %s', (code, reason) => {
    const err = failureForAssistantError(code)
    expect(err).toBeInstanceOf(ProviderFailureError)
    expect(err.reason).toBe(reason)
  })

  it('never carries the SDK text: the message is the closed reason only', () => {
    const err = failureForAssistantError('authentication_failed')
    expect(err.message).toBe('Provider failure: reauth_required')
  })
})

describe('failureForRateLimit', () => {
  const now = () => 1_800_000_000_000

  it('is a plan limit with a wait in seconds when resetsAt is epoch seconds', () => {
    const err = failureForRateLimit({ resetsAt: 1_800_000_090 }, now)
    expect(err.reason).toBe('plan_limit_reached')
    expect(err.retryAfter).toBe(90)
  })

  it('reads resetsAt as epoch milliseconds when it is that large', () => {
    expect(failureForRateLimit({ resetsAt: 1_800_000_090_000 }, now).retryAfter).toBe(90)
  })

  it('has no wait when the reset is unknown or already past', () => {
    expect(failureForRateLimit({}, now).retryAfter).toBeUndefined()
    expect(failureForRateLimit({ resetsAt: 1_700_000_000 }, now).retryAfter).toBe(0)
  })
})
