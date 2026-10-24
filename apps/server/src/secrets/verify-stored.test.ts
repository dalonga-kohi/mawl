import { describe, expect, it } from 'vitest'
import { SecretDecryptError } from './secret-box.ts'
import { verifyStoredSecrets } from './verify-stored.ts'

const empty = async () => 'empty' as const
const verified = async () => 'verified' as const
const unreadable = async (): Promise<'verified' | 'empty'> => {
  throw new SecretDecryptError()
}

describe('verifyStoredSecrets', () => {
  it('is empty when no store holds a secret', async () => {
    expect(await verifyStoredSecrets([empty, empty])).toBe('empty')
  })

  it('is verified when one store decrypts and the others are empty', async () => {
    expect(await verifyStoredSecrets([empty, verified])).toBe('verified')
  })

  it('fails when any store holds a secret the key cannot open, even with no provider keys', async () => {
    await expect(verifyStoredSecrets([empty, unreadable])).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
    await expect(verifyStoredSecrets([verified, unreadable])).rejects.toBeInstanceOf(
      SecretDecryptError,
    )
  })
})
