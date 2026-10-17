import {
  AGENT_NAME_HINT,
  AUTHORIZE_URL,
  CALLBACK_PATH,
  DYNAMIC_CLIENT_ID,
  RESOURCE,
  SCOPES,
} from './constants.ts'

/** The loopback redirect. 127.0.0.1 only (never localhost); just the port may vary. */
export function redirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CALLBACK_PATH}`
}

export interface AuthorizeParams {
  /** The issued `oaiapp_...` id from an earlier sign-in, or null on first registration. */
  clientId: string | null
  hostId: string
  redirectUri: string
  state: string
  nonce: string
  challenge: string
}

export function buildAuthorizeUrl(p: AuthorizeParams): string {
  if (p.clientId === DYNAMIC_CLIENT_ID) {
    throw new Error('the dynamic client id is a placeholder and is never a saved client id')
  }
  const redirect = new URL(p.redirectUri)
  if (
    redirect.protocol !== 'http:' ||
    redirect.hostname !== '127.0.0.1' ||
    redirect.pathname !== CALLBACK_PATH
  ) {
    throw new Error('the redirect must be http://127.0.0.1:<port>/auth/callback')
  }
  const url = new URL(AUTHORIZE_URL)
  const q = url.searchParams
  q.set('client_id', p.clientId ?? DYNAMIC_CLIENT_ID)
  if (p.clientId === null) q.set('agent_name_hint', AGENT_NAME_HINT)
  q.set('ext_agent_host_id', p.hostId)
  q.set('response_type', 'code')
  q.set('redirect_uri', p.redirectUri)
  q.set('scope', SCOPES)
  q.set('resource', RESOURCE)
  q.set('state', p.state)
  q.set('nonce', p.nonce)
  q.set('code_challenge_method', 'S256')
  q.set('code_challenge', p.challenge)
  return url.toString()
}
