import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createSecretBox, SecretDecryptError } from './secret-box.ts'

const AAD = 'provider_credentials:pcr_1'
const newKey = () => new Uint8Array(randomBytes(32))

describe('secret box', () => {
  it('round-trips text, unicode and the empty string', async () => {
    const box = await createSecretBox(newKey())
    for (const text of ['sk-test-123', 'zażółć gęślą jaźń 🔐', '']) {
      expect(box.decrypt(box.encrypt(text, AAD), AAD)).toBe(text)
    }
  })

  it('writes version 0x01, a 24 byte nonce, then ciphertext plus 16 byte tag', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('abc', AAD)
    expect(blob[0]).toBe(0x01)
    expect(blob.length).toBe(1 + 24 + 3 + 16)
  })

  it('uses a fresh nonce for each encryption', async () => {
    const box = await createSecretBox(newKey())
    const a = box.encrypt('same', AAD)
    const b = box.encrypt('same', AAD)
    expect(Buffer.from(a.slice(1, 25)).equals(Buffer.from(b.slice(1, 25)))).toBe(false)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false)
  })

  it('rejects a single flipped bit anywhere in the blob', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('top secret', AAD)
    for (let i = 0; i < blob.length; i++) {
      const bad = blob.slice()
      bad[i] = (bad[i] as number) ^ 0x01
      expect(() => box.decrypt(bad, AAD), `byte ${i}`).toThrow(SecretDecryptError)
    }
  })

  it('rejects a wrong aad', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('x', AAD)
    expect(() => box.decrypt(blob, 'provider_credentials:pcr_2')).toThrow(SecretDecryptError)
  })

  it('rejects a wrong key', async () => {
    const blob = (await createSecretBox(newKey())).encrypt('x', AAD)
    const other = await createSecretBox(newKey())
    expect(() => other.decrypt(blob, AAD)).toThrow(SecretDecryptError)
  })

  it('rejects an unknown version byte', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('x', AAD)
    blob[0] = 0x02
    expect(() => box.decrypt(blob, AAD)).toThrow(SecretDecryptError)
  })

  it('rejects short blobs', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('x', AAD)
    for (const len of [0, 1, 25, 40, blob.length - 1]) {
      expect(() => box.decrypt(blob.slice(0, len), AAD), `len ${len}`).toThrow(SecretDecryptError)
    }
  })

  it('throws one fixed message with no detail', async () => {
    const box = await createSecretBox(newKey())
    const blob = box.encrypt('hunter2', AAD)
    const messages = new Set<string>()
    for (const attempt of [
      () => box.decrypt(blob, 'other'),
      () => box.decrypt(blob.slice(0, 3), AAD),
      () => box.decrypt(Object.assign(blob.slice(), { 0: 9 }), AAD),
    ]) {
      try {
        attempt()
      } catch (e) {
        messages.add((e as Error).message)
      }
    }
    expect(messages).toEqual(new Set(['Failed to decrypt secret']))
  })

  it('can be reused across many calls', async () => {
    const box = await createSecretBox(newKey())
    for (let i = 0; i < 50; i++) expect(box.decrypt(box.encrypt(`v${i}`, AAD), AAD)).toBe(`v${i}`)
  })

  it('rejects a key that is not 32 bytes', async () => {
    await expect(createSecretBox(new Uint8Array(31))).rejects.toThrow(/32 bytes/)
  })

  it('does not keep a reference to the caller key array', async () => {
    const key = newKey()
    const box = await createSecretBox(key)
    const blob = box.encrypt('x', AAD)
    key.fill(0)
    expect(box.decrypt(blob, AAD)).toBe('x')
  })
})
