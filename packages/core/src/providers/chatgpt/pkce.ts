import { createHash, randomBytes } from 'node:crypto'

export type RandomBytes = (size: number) => Uint8Array

export const systemRandom: RandomBytes = (size) => new Uint8Array(randomBytes(size))

/** RFC 7636 S256: base64url (no padding) of the SHA-256 of the verifier. */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

/** A 43 char verifier from 32 random bytes, with its S256 challenge. */
export function createPkce(random: RandomBytes = systemRandom): {
  verifier: string
  challenge: string
} {
  const verifier = Buffer.from(random(32)).toString('base64url')
  return { verifier, challenge: codeChallenge(verifier) }
}
