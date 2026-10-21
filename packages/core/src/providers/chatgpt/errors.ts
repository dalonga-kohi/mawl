import type { ProviderFailureReason } from '@mawl/contracts'

const BY_CODE: Record<string, ProviderFailureReason> = {
  subscription_sharing_usage_limit_exceeded: 'plan_limit_reached',
  subscription_sharing_user_not_eligible: 'not_eligible',
  subscription_sharing_usage_unavailable: 'temporarily_unavailable',
  subscription_sharing_user_unavailable: 'temporarily_unavailable',
  subscription_sharing_unsupported_capability: 'unsupported_capability',
  subscription_sharing_route_not_supported: 'config_error',
  chatpass_v2_scope_not_authorized: 'config_error',
  chatpass_v2_invalid_authorization_context: 'config_error',
}

/** Maps a Responses `error.code` (or, failing that, the http status) to a closed reason. */
export function mapResponsesError(code: string | undefined, status: number): ProviderFailureReason {
  const byCode = code === undefined ? undefined : BY_CODE[code]
  if (byCode) return byCode
  if (status === 429) return 'plan_limit_reached'
  if (status === 403) return 'not_eligible'
  if (status === 400) return 'unsupported_capability'
  if (status === 401) return 'config_error'
  if (status >= 500) return 'temporarily_unavailable'
  return 'provider_error'
}

const CODE = /^[a-z][a-z0-9_]{0,99}$/

/**
 * Pulls a machine code out of an error body: `{error: {code}}`, `{code}` or an OAuth
 * `{error: "invalid_grant"}`. Only plain snake_case codes pass, so provider prose (which can
 * echo a credential) never becomes data.
 */
export function extractErrorCode(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const b = body as { error?: unknown; code?: unknown }
  const candidates: unknown[] = [
    b.error && typeof b.error === 'object' ? (b.error as { code?: unknown }).code : undefined,
    b.code,
    typeof b.error === 'string' ? b.error : undefined,
  ]
  for (const c of candidates) if (typeof c === 'string' && CODE.test(c)) return c
  return undefined
}
