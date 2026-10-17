import sodium from 'libsodium-wrappers'

const VERSION = 0x01
const NONCE_BYTES = 24
const KEY_BYTES = 32
const TAG_BYTES = 16
const HEADER_BYTES = 1 + NONCE_BYTES

/** Thrown for every decrypt failure. Deliberately carries no detail about the cause. */
export class SecretDecryptError extends Error {
  constructor() {
    super('Failed to decrypt secret')
    this.name = 'SecretDecryptError'
  }
}

export interface SecretBox {
  /**
   * Blob: version byte 0x01 ‖ 24-byte random nonce ‖ XChaCha20-Poly1305 ciphertext+tag.
   * `aad` is authenticated, not stored: pass the owning row (e.g. `provider_credentials:<id>`)
   * so a ciphertext cannot be moved to another row.
   */
  encrypt(plaintext: string, aad: string): Uint8Array
  decrypt(blob: Uint8Array, aad: string): string
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function createSecretBox(masterKey: Uint8Array): Promise<SecretBox> {
  if (masterKey.length !== KEY_BYTES) {
    throw new Error(`Secret box key must be ${KEY_BYTES} bytes`)
  }
  await sodium.ready
  const key = masterKey.slice()

  return {
    encrypt(plaintext, aad) {
      const message = encoder.encode(plaintext)
      try {
        const nonce = sodium.randombytes_buf(NONCE_BYTES)
        const sealed = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
          message,
          encoder.encode(aad),
          null,
          nonce,
          key,
        )
        const blob = new Uint8Array(HEADER_BYTES + sealed.length)
        blob[0] = VERSION
        blob.set(nonce, 1)
        blob.set(sealed, HEADER_BYTES)
        return blob
      } finally {
        sodium.memzero(message)
      }
    },

    decrypt(blob, aad) {
      if (blob.length < HEADER_BYTES + TAG_BYTES || blob[0] !== VERSION) {
        throw new SecretDecryptError()
      }
      let message: Uint8Array | undefined
      try {
        message = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
          null,
          blob.subarray(HEADER_BYTES),
          encoder.encode(aad),
          blob.subarray(1, HEADER_BYTES),
          key,
        )
        return decoder.decode(message)
      } catch {
        throw new SecretDecryptError()
      } finally {
        if (message) sodium.memzero(message)
      }
    },
  }
}
