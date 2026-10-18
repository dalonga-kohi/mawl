import type { ChatGptSignInFailure, ProviderKind, ProviderTestFailure } from '@faire/contracts'

/** Plain-language results of a connection check. Errors say how to fix the problem. */
export function testFailureText(reason: ProviderTestFailure, kind: ProviderKind): string {
  switch (reason) {
    case 'invalid_key':
      return kind === 'openai_chatgpt'
        ? 'ChatGPT no longer accepts this sign-in. Sign in again.'
        : 'The key was rejected. Paste a new one.'
    case 'unreachable':
      return "Couldn't reach the provider. Check the address and your connection."
    case 'rate_limited':
      return kind === 'openai_chatgpt'
        ? "You've used your ChatGPT plan's limit for now."
        : 'The provider is limiting requests for this key. Try again in a minute.'
    case 'unexpected_response':
      return "The provider answered in a way Faire didn't expect. Check the address."
    case 'not_signed_in':
      return "Claude Code isn't signed in. Run claude auth login on the computer running Faire."
    case 'wrong_auth_method':
      return 'Claude Code is set up with an API key or token, not your Claude plan. Faire only uses the plan sign-in.'
  }
}

export function signInFailureText(reason: ChatGptSignInFailure): string {
  switch (reason) {
    case 'access_denied':
      return 'Sign-in was cancelled in ChatGPT.'
    case 'expired':
      return 'The sign-in took longer than 10 minutes. Start again.'
    case 'cancelled':
      return 'A newer sign-in replaced this one.'
    default:
      return "ChatGPT sign-in didn't finish. Try again."
  }
}

export const CHATGPT_USAGE_URL = 'https://chatgpt.com/settings/usage'
export const CHATGPT_SETTINGS_URL = 'https://chatgpt.com/settings'
