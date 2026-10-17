import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import { Device, PairingCode, PublicKey } from './entities'
import { contract } from './router'

const KEY = `${'A'.repeat(42)}Q` // 32 bytes, base64url, no padding

describe('PublicKey (Ed25519, base64url, 32 bytes)', () => {
  it.each([KEY, 'A'.repeat(43), `${'_-'.repeat(21)}A`])('accepts %s', (k) => {
    expect(PublicKey.safeParse(k).success).toBe(true)
  })

  it.each([
    ['too short', 'A'.repeat(42)],
    ['too long', 'A'.repeat(44)],
    ['padded', `${'A'.repeat(43)}=`],
    ['standard base64 alphabet', `${'+/'.repeat(21)}A`],
    ['non-canonical trailing bits', `${'A'.repeat(42)}B`],
    ['empty', ''],
    ['whitespace', ` ${'A'.repeat(43)}`],
  ])('rejects %s', (_n, k) => {
    expect(PublicKey.safeParse(k).success).toBe(false)
  })

  it('is enforced on the Device entity', () => {
    expect(Device.safeParse({ ...validDevice(), pubkey: 'AAAA' }).success).toBe(false)
  })
})

describe('PairingCode (8 Crockford chars, case-insensitive input)', () => {
  it('normalises to uppercase', () => {
    expect(PairingCode.parse('7k3m9x2q')).toBe('7K3M9X2Q')
  })

  it('rejects inputs that only become valid after Unicode uppercasing', () => {
    expect(PairingCode.safeParse('ßßßß').success).toBe(false)
    expect(PairingCode.safeParse('ſſſſſſſſ').success).toBe(false)
  })

  it.each(['7K3M9X2', '7K3M9X2QQ', '7K3M9X2I', '7K3M9X2U', '7K3M 9X2', '', '7K3M9X2-'])(
    'rejects %j',
    (c) => {
      expect(PairingCode.safeParse(c).success).toBe(false)
    },
  )
})

describe('devices.pair', () => {
  const input = contract.devices.pair['~orpc'].inputSchema
  const output = contract.devices.pair['~orpc'].outputSchema
  const ok = { name: 'Phone', pubkey: KEY, platform: 'ios', pairingCode: '7k3m9x2q' }

  it('accepts a valid request, normalising the code', async () => {
    const r = await input?.['~standard'].validate(ok)
    expect(r).toMatchObject({ value: { pairingCode: '7K3M9X2Q' } })
  })

  it('is strict: rejects extra keys', async () => {
    expect(await input?.['~standard'].validate({ ...ok, role: 'admin' })).toHaveProperty('issues')
  })

  it('returns the device plus a session token', async () => {
    const out = {
      device: validDevice(),
      session: { token: 't0k', expiresAt: '2026-01-02T03:04:05.000Z' },
    }
    expect(await output?.['~standard'].validate(out)).toMatchObject({ value: out })
    expect(await output?.['~standard'].validate({ device: validDevice() })).toHaveProperty('issues')
  })

  it('types the output', () => {
    type Out = z.infer<NonNullable<typeof output>>
    expectTypeOf<Out>().toHaveProperty('session')
  })
})

function validDevice() {
  return {
    id: 'dev_01HZX3K9V2M4N6P8Q0R2S4T6V8',
    name: 'Laptop',
    pubkey: KEY,
    platform: 'desktop',
    lastSeenAt: null,
    revokedAt: null,
  }
}
