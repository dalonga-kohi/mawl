import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { TEST_AUTH_TOKEN } from './auth/test-util.ts'
import { HEALTH_NONCE_PATTERN, identityProof } from './health-identity.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'

function app(checkDb: () => Promise<void> = async () => {}) {
  return createApp({
    logger: createLogger({ level: 'silent' }),
    version: '1.0.0',
    providers: unusedProviders,
    runs: unusedRuns,
    checkDb,
    healthTimeoutMs: 50,
    authToken: TEST_AUTH_TOKEN,
  })
}

const NONCE = 'nonce-0123456789abcdef'

describe('the /healthz identity proof', () => {
  it('matches the desktop host (Rust hmac crate) byte for byte', () => {
    // Same vector as `the_proof_matches_the_servers_node_crypto` in host/src/health.rs.
    expect(identityProof('A'.repeat(43), NONCE)).toBe('dc8lbpULN4pFq5l1YGMpGXjfCBh8w-gMbEyvvwluwFA')
  })

  it('answers a nonce with the proof, and nothing that contains the token', async () => {
    const res = await app().request(`/healthz?n=${NONCE}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; id?: string }
    expect(body).toEqual({ ok: true, id: identityProof(TEST_AUTH_TOKEN, NONCE) })
    expect(JSON.stringify(body)).not.toContain(TEST_AUTH_TOKEN)
  })

  it('gives a different proof for every nonce, so an old answer cannot be replayed', async () => {
    const a = (await (await app().request('/healthz?n=aaaaaaaaaaaaaaaa')).json()) as { id: string }
    const b = (await (await app().request('/healthz?n=bbbbbbbbbbbbbbbb')).json()) as { id: string }
    expect(a.id).not.toBe(b.id)
  })

  it('stays the plain answer without a nonce or with a malformed one', async () => {
    for (const query of [
      '',
      '?n=',
      '?n=short',
      `?n=${'x'.repeat(129)}`,
      '?n=has%20space',
      '?n=a.b.c.d.e.f.g.h.i',
    ]) {
      const res = await app().request(`/healthz${query}`)
      expect(await res.json(), query).toEqual({ ok: true })
    }
    expect(HEALTH_NONCE_PATTERN.test('A'.repeat(16))).toBe(true)
  })

  it('still proves itself when the database is down, with a 503', async () => {
    const res = await app(async () => {
      throw new Error('down')
    }).request(`/healthz?n=${NONCE}`)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, id: identityProof(TEST_AUTH_TOKEN, NONCE) })
  })
})
