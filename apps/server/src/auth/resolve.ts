import { join } from 'node:path'
import type { Config } from '../config.ts'
import { registerSecretValue } from '../redact.ts'
import { loadOrCreateOwnerToken, OWNER_TOKEN_FILE } from '../secrets/owner-token.ts'

export interface ResolveAuthTokenOptions {
  /**
   * Shows a newly generated owner token to the operator, once. This is the one deliberate path
   * around the log redactor, so it must write plain text straight to the terminal (main passes
   * stderr), never through the logger.
   */
  announce?: (text: string) => void
}

/** The one-time notice for a generated owner token. */
export function ownerTokenNotice(token: string, file: string): string {
  return [
    '',
    'Mawl generated an owner token. Enter it when the web app asks for it:',
    '',
    `    ${token}`,
    '',
    `It is shown only this once. Read it again later from ${file}`,
    'or replace it by setting MAWL_OWNER_TOKEN.',
    '',
  ].join('\n')
}

/**
 * The token `/rpc` and `/ws` require. Desktop: the launch token from stdin (never anything else,
 * so a missing one fails boot). Headless: `MAWL_OWNER_TOKEN`, else the owner token stored in the
 * secrets dir, generated on first boot. Every token is registered with the log redactor before it
 * is returned.
 */
export async function resolveAuthToken(
  config: Config,
  { announce }: ResolveAuthTokenOptions = {},
): Promise<string> {
  if (config.mode === 'desktop') {
    if (!config.launchToken) throw new Error('desktop mode needs the launch token from stdin')
    registerSecretValue(config.launchToken)
    return config.launchToken
  }
  if (config.ownerToken) {
    registerSecretValue(config.ownerToken)
    return config.ownerToken
  }
  const { token, created } = await loadOrCreateOwnerToken(config.secretsDir)
  registerSecretValue(token)
  if (created) announce?.(ownerTokenNotice(token, join(config.secretsDir, OWNER_TOKEN_FILE)))
  return token
}
