export type StoredSecretCheck = () => Promise<'verified' | 'empty'>

/**
 * Runs every store's master-key check (provider credentials, service keys): 'verified' if at least
 * one decrypted, 'empty' if none holds a secret. Any store whose secret does not decrypt rejects
 * with its `SecretDecryptError`, so boot stops before a new key orphans that secret.
 */
export async function verifyStoredSecrets(
  checks: readonly StoredSecretCheck[],
): Promise<'verified' | 'empty'> {
  let result: 'verified' | 'empty' = 'empty'
  for (const check of checks) {
    if ((await check()) === 'verified') result = 'verified'
  }
  return result
}
