import { describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { TEST_AUTH_TOKEN } from './auth/test-util.ts'
import type { HostPolicy } from './events/host.ts'
import { HEALTH_IDENTITY_DOMAIN, HEALTH_NONCE_PATTERN, identityProof } from './health-identity.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'

function app(checkDb: () => Promise<void> = async () => {}, hosts?: HostPolicy) {
  return createApp({
    logger: createLogger({ level: 'silent' }),
    version: '1.0.0',
    providers: unusedProviders,
    runs: unusedRuns,
    checkDb,
    healthTimeoutMs: 50,
    authToken: TEST_AUTH_TOKEN,
    ...(hosts ? { hosts } : {}),
  })
}

const NONCE = 'nonce-0123456789abcdef'
const LOCAL = 'http://127.0.0.1:7420'
const HEADLESS: HostPolicy = {
  bindHost: '0.0.0.0',
  allowedOrigins: ['https://mawl.tail1234.ts.net'],
}

/** `/healthz` as the host asks it: a nonce, the origin it used, and that origin's Host header. */
function probe(origin: string, host: string, nonce = NONCE): Request {
  const query = new URLSearchParams({ n: nonce, o: origin })
  return new Request(`${origin}/healthz?${query}`, { headers: { host } })
}

describe('the /healthz identity proof (v2, bound to the origin)', () => {
  it('matches the desktop host (Rust hmac crate) byte for byte', () => {
    // Same vectors as `the_proof_matches_the_servers_node_crypto` in host/src/health.rs.
    expect(HEALTH_IDENTITY_DOMAIN).toBe('mawl/healthz-identity/v2:')
    expect(identityProof('A'.repeat(43), NONCE, LOCAL)).toBe(
      '_ZIk-YGbotCsazOcJxgmrUUZ9XJH-P3cXYvWhQlsrGI',
    )
    expect(identityProof('A'.repeat(43), NONCE, 'https://mawl.example.com')).toBe(
      'iro1oJSCGdnqUbZvjwbm84bkG0LGESNudAbimurco-c',
    )
  })

  it('answers a nonce and an origin with the proof, and nothing that contains the token', async () => {
    const res = await app().request(probe(LOCAL, '127.0.0.1:7420'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; id?: string }
    expect(body).toEqual({ ok: true, id: identityProof(TEST_AUTH_TOKEN, NONCE, LOCAL) })
    expect(JSON.stringify(body)).not.toContain(TEST_AUTH_TOKEN)
  })

  it('gives a different proof for every nonce and every origin', async () => {
    const id = async (r: Request) => ((await (await app().request(r)).json()) as { id: string }).id
    const a = await id(probe(LOCAL, '127.0.0.1:7420', 'a'.repeat(16)))
    const b = await id(probe(LOCAL, '127.0.0.1:7420', 'b'.repeat(16)))
    const c = await id(probe('http://localhost:7420', 'localhost:7420', 'a'.repeat(16)))
    expect(new Set([a, b, c]).size).toBe(3)
  })

  it('proves an allowed headless origin behind a proxy, which may rewrite Host to loopback', async () => {
    const origin = 'https://mawl.tail1234.ts.net'
    for (const host of ['mawl.tail1234.ts.net', '127.0.0.1:7420']) {
      const res = await app(async () => {}, HEADLESS).request(probe(origin, host))
      expect(res.status, host).toBe(200)
      expect(await res.json()).toEqual({
        ok: true,
        id: identityProof(TEST_AUTH_TOKEN, NONCE, origin),
      })
    }
  })

  it('refuses a proof for an origin that is not its own: a look-alike relaying the probe gets nothing', async () => {
    // The relay forwards the client's probe for its own origin, with the real server's Host.
    const relayed = probe('https://mawl-tail1234.example', 'mawl.tail1234.ts.net')
    const res = await app(async () => {}, HEADLESS).request(relayed)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false })
  })

  it('refuses a nonce on a Host outside its HostPolicy', async () => {
    const res = await app(async () => {}, HEADLESS).request(
      probe('https://mawl.tail1234.ts.net', 'evil.example'),
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ ok: false })
    // Without hosts (unit wiring) only loopback counts as its own.
    const loose = await app().request(probe('https://mawl.tail1234.ts.net', '127.0.0.1:7420'))
    expect(loose.status).toBe(403)
  })

  it('stays the plain answer without a nonce, with a malformed one, or with no usable origin', async () => {
    for (const query of [
      '',
      '?n=',
      '?n=short',
      `?n=${'x'.repeat(129)}`,
      '?n=has%20space',
      '?n=a.b.c.d.e.f.g.h.i',
      // v1 probes (no origin) get no proof any more.
      `?n=${NONCE}`,
      `?n=${NONCE}&o=`,
      `?n=${NONCE}&o=127.0.0.1%3A7420`,
      `?n=${NONCE}&o=${encodeURIComponent(`${LOCAL}/`)}`,
      `?n=${NONCE}&o=${encodeURIComponent(`${LOCAL}/x`)}`,
      `?n=${NONCE}&o=${encodeURIComponent('ftp://127.0.0.1')}`,
      `?n=${NONCE}&o=${encodeURIComponent('http://u:p@127.0.0.1:7420')}`,
      `?n=${NONCE}&o=${encodeURIComponent('HTTP://127.0.0.1:7420')}`,
    ]) {
      const res = await app().request(
        new Request(`http://127.0.0.1:7420/healthz${query}`, {
          headers: { host: '127.0.0.1:7420' },
        }),
      )
      expect(res.status, query).toBe(200)
      expect(await res.json(), query).toEqual({ ok: true })
    }
    expect(HEALTH_NONCE_PATTERN.test('A'.repeat(16))).toBe(true)
  })

  it('still proves itself when the database is down, with a 503', async () => {
    const res = await app(async () => {
      throw new Error('down')
    }).request(probe(LOCAL, '127.0.0.1:7420'))
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      ok: false,
      id: identityProof(TEST_AUTH_TOKEN, NONCE, LOCAL),
    })
  })
})
