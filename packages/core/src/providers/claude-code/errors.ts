import type { ProviderFailureReason } from '@mawl/contracts'
import { ProviderFailureError } from '../failure.ts'

const REASONS: Record<string, ProviderFailureReason> = {
  rate_limit: 'plan_limit_reached',
  authentication_failed: 'reauth_required',
  oauth_org_not_allowed: 'reauth_required',
  verification_required: 'reauth_required',
  account_on_hold: 'not_eligible',
  billing_error: 'not_eligible',
  overloaded: 'temporarily_unavailable',
  server_error: 'temporarily_unavailable',
  model_not_found: 'config_error',
  invalid_request: 'config_error',
}

/**
 * Maps the Claude Code assistant error code to a closed failure. The SDK's own text is never
 * read or passed on; an unknown or new code is a plain provider error.
 */
export function failureForAssistantError(code: string): ProviderFailureError {
  // Own-property check: a code like "constructor" must not reach the prototype chain.
  const reason = Object.hasOwn(REASONS, code) ? REASONS[code] : undefined
  return new ProviderFailureError(reason ?? 'provider_error')
}

/** `resetsAt` is epoch seconds in practice; a value this large can only be milliseconds. */
const MS_THRESHOLD = 100_000_000_000

/** A rejected rate-limit event: the plan window is used up. Carries the wait when known. */
export function failureForRateLimit(
  info: { resetsAt?: number | undefined },
  now: () => number = Date.now,
): ProviderFailureError {
  if (info.resetsAt === undefined) return new ProviderFailureError('plan_limit_reached')
  const resetMs = info.resetsAt >= MS_THRESHOLD ? info.resetsAt : info.resetsAt * 1000
  const retryAfter = Math.max(0, Math.ceil((resetMs - now()) / 1000))
  return new ProviderFailureError('plan_limit_reached', { retryAfter })
}
