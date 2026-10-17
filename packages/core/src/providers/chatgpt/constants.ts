/** Documented endpoints for Sign in with ChatGPT (developers.openai.com/siwc, checked 2026-10-18). */
export const OPENAI_ISSUER = 'https://auth.openai.com'
export const AUTHORIZE_URL = 'https://auth.openai.com/api/accounts/authorize'
export const TOKEN_URL = 'https://auth.openai.com/api/accounts/oauth/token'
/** `revocation_endpoint` from the issuer's openid-configuration. */
export const REVOKE_URL = 'https://auth.openai.com/api/accounts/oauth/revoke'

/** The resource (audience) the plan-usage tokens are issued for; also the inference base url. */
export const RESOURCE = 'https://api.openai.com/v1'

/** Stands in for a client id on first sign-in only. OpenAI issues the real `oaiapp_...` id. */
export const DYNAMIC_CLIENT_ID = 'dynamic_agent_client'
export const AGENT_NAME_HINT = 'Faire'

export const DIRECT_SCOPE = 'chatgpt.tokens.use.direct'
export const SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'resource.invoke',
  DIRECT_SCOPE,
].join(' ')

export const CALLBACK_PATH = '/auth/callback'
export const DEFAULT_SIWC_PORT = 1455

/** Refresh when the access token has less than this left. */
export const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** Sent in place of an API key: the SDK insists on one, and the fetch wrapper replaces the header. */
export const PLACEHOLDER_API_KEY = 'chatgpt-oauth'
