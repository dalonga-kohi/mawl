import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DbHandle } from '@mawl/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import { TEST_AUTH_HEADERS, TEST_AUTH_TOKEN } from './auth/test-util.ts'
import { ConfigError, parseConfig } from './config.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'
import { createSecretBox, loadOrCreateMasterKey, SecretDecryptError } from './secrets/index.ts'
import { startServer } from './server.ts'

function capture() {
  const lines: string[] = []
  const logger = createLogger({
    level: 'info',
    stream: { write: (chunk: string) => void lines.push(chunk) },
  })
  return { logger, lines }
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mawl-edge-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

describe('logger redaction depth', () => {
  it('redacts a secret under input.secret', () => {
    const { logger, lines } = capture()
    logger.info({ input: { secret: 'LEAK-ME' } }, 'x')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('redacts apiKey inside an array of credentials', () => {
    const { logger, lines } = capture()
    logger.info({ creds: [{ apiKey: 'LEAK-ME' }] }, 'x')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('redacts a secret two levels below the logged object', () => {
    const { logger, lines } = capture()
    logger.info({ input: { provider: { apiKey: 'LEAK-ME', token: 'LEAK-ME-2' } } }, 'x')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('redacts a secret on a logged err object', () => {
    const { logger, lines } = capture()
    logger.info({ err: { password: 'LEAK-ME' } }, 'x')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })
})

describe('app edge cases', () => {
  it('never logs a ?ticket= query on /rpc or unknown paths', async () => {
    const { logger, lines } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: async () => {},
    })
    await app.request('/rpc/health/get?ticket=LEAK-ME', {
      method: 'POST',
      headers: TEST_AUTH_HEADERS,
    })
    await app.request('/nope?ticket=LEAK-ME')
    await app.request('/healthz?ticket=LEAK-ME')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('answers an unknown /rpc path with 404, not 500', async () => {
    const { logger } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: async () => {},
    })
    for (const p of ['/rpc/nope', '/rpc/health/nope', '/rpc/', '/rpc/a/b/c/d']) {
      const res = await app.request(p, { method: 'POST', headers: TEST_AUTH_HEADERS })
      expect(res.status, p).toBe(404)
    }
  })

  it('answers malformed rpc JSON with a 4xx, never 500, and does not log the body', async () => {
    const { logger, lines } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: async () => {},
    })
    const res = await app.request('/rpc/health/get', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...TEST_AUTH_HEADERS },
      body: '{"json": "LEAK-ME',
    })
    expect(res.status).toBeLessThan(500)
    expect(lines.join('')).not.toContain('LEAK-ME')
  })

  it('healthz returns 503 when checkDb hangs forever (fake timers)', async () => {
    vi.useFakeTimers()
    const { logger } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: () => new Promise(() => {}),
    })
    const pending = Promise.resolve(app.request('/healthz'))
    await vi.advanceTimersByTimeAsync(1999)
    let settled = false
    void pending.then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    const res = await pending
    expect(res.status).toBe(503)
    expect(await res.text()).toBe('{"ok":false}')
  })

  it('healthz returns 503 and no secret when checkDb throws synchronously', async () => {
    const { logger, lines } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: () => {
        throw new Error('postgres://u:LEAK-ME@h/d')
      },
    })
    const res = await app.request('/healthz')
    expect(await res.text()).not.toContain('LEAK-ME')
    expect(lines.join('')).not.toContain('LEAK-ME')
    expect(res.status).toBe(503)
  })

  it('does not leak the error message from an unhandled route error into logs', async () => {
    const { logger, lines } = capture()
    const app = createApp({
      logger,
      version: '1',
      authToken: TEST_AUTH_TOKEN,
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: async () => {},
    })
    app.get('/boom', () => {
      throw new Error('apiKey=LEAK-ME')
    })
    const res = await app.request('/boom?apiKey=LEAK-ME')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('LEAK-ME')
    expect(lines.join('')).not.toContain('LEAK-ME')
  })
})

describe('config edge cases', () => {
  const base = { DATABASE_URL: 'postgres://u:hunter2@h/d' }
  it.each(['0', '65536', '-1', '80.5', 'abc', '1e3', ' 80', '99999999999999999999'])(
    'rejects MAWL_PORT=%s without echoing the DATABASE_URL password',
    (port) => {
      let err: unknown
      try {
        parseConfig({ ...base, MAWL_PORT: port })
      } catch (e) {
        err = e
      }
      expect(err).toBeInstanceOf(ConfigError)
      expect(String((err as Error).message)).not.toContain('hunter2')
      expect(JSON.stringify((err as ConfigError).issues)).not.toContain('hunter2')
    },
  )

  it.each(['65535', '1'])('accepts boundary MAWL_PORT=%s', (port) => {
    expect(parseConfig({ ...base, MAWL_PORT: port }).port).toBe(Number(port))
  })

  it.each(['verbose', 'INFO', 'warning', ' info'])('rejects LOG_LEVEL=%s', (level) => {
    expect(() => parseConfig({ ...base, LOG_LEVEL: level })).toThrow(ConfigError)
  })

  it('does not leak a bad DATABASE_URL value into the error', () => {
    for (const bad of ['mysql://u:hunter2@h/d', 'postgres://u:hunter2@[bad/d', 'hunter2']) {
      let msg = ''
      try {
        parseConfig({ DATABASE_URL: bad })
      } catch (e) {
        msg = `${(e as Error).message}${JSON.stringify((e as ConfigError).issues)}`
      }
      expect(msg).not.toBe('')
      expect(msg).not.toContain('hunter2')
    }
  })
})

describe('master key edge cases', () => {
  it('rejects an empty key file and leaves it empty', async () => {
    const file = join(dir, 'master.key')
    await writeFile(file, '')
    await expect(loadOrCreateMasterKey(dir)).rejects.toThrow(/exactly 32 bytes/)
    expect((await readFile(file)).length).toBe(0)
  })

  it.each([31, 33, 64])('rejects a %i-byte key file and never rewrites it', async (n) => {
    const file = join(dir, 'master.key')
    const original = Buffer.alloc(n, 7)
    await writeFile(file, original)
    await expect(loadOrCreateMasterKey(dir)).rejects.toThrow()
    expect((await readFile(file)).equals(original)).toBe(true)
  })

  it('does not echo key bytes in the error', async () => {
    await writeFile(join(dir, 'master.key'), 'SUPERSECRETKEYMATERIAL')
    const err = await loadOrCreateMasterKey(dir).catch((e: unknown) => e as Error)
    expect(String((err as Error).message)).not.toContain('SUPERSECRET')
  })

  it('errors when the secrets dir path is an existing file', async () => {
    const asFile = join(dir, 'secrets')
    await writeFile(asFile, 'not a dir')
    await expect(loadOrCreateMasterKey(asFile)).rejects.toThrow()
    expect(await readFile(asFile, 'utf8')).toBe('not a dir')
  })

  it('errors when master.key is a directory', async () => {
    await mkdir(join(dir, 'master.key'))
    await expect(loadOrCreateMasterKey(dir)).rejects.toThrow()
  })

  it('leaves no temp files behind after a rejected key', async () => {
    await writeFile(join(dir, 'master.key'), '')
    await loadOrCreateMasterKey(dir).catch(() => {})
    const { readdir } = await import('node:fs/promises')
    expect(await readdir(dir)).toEqual(['master.key'])
  })

  it('concurrent first boots all get the same key', async () => {
    const keys = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateMasterKey(dir)))
    for (const k of keys)
      expect(Buffer.from(k).equals(Buffer.from(keys[0] as Uint8Array))).toBe(true)
  })
})

describe('secret box edge cases', () => {
  const key = new Uint8Array(32).fill(9)

  it('round-trips empty, unicode and large plaintext', async () => {
    const box = await createSecretBox(key)
    for (const text of ['', 'zażółć gęślą jaźń 🔐 \u0000 end', 'x'.repeat(1_000_000)]) {
      expect(box.decrypt(box.encrypt(text, 'a'), 'a')).toBe(text)
    }
  })

  it('round-trips an empty aad and rejects a different aad', async () => {
    const box = await createSecretBox(key)
    const blob = box.encrypt('s', '')
    expect(box.decrypt(blob, '')).toBe('s')
    expect(() => box.decrypt(blob, 'x')).toThrow(SecretDecryptError)
  })

  it('rejects a flip in every single byte of the blob', async () => {
    const box = await createSecretBox(key)
    const blob = box.encrypt('top secret', 'row:1')
    for (let i = 0; i < blob.length; i++) {
      const bad = blob.slice()
      bad[i] = (bad[i] as number) ^ 0x01
      expect(() => box.decrypt(bad, 'row:1'), `byte ${i}`).toThrow(SecretDecryptError)
    }
  })

  it('rejects empty, short, truncated and extended blobs', async () => {
    const box = await createSecretBox(key)
    const blob = box.encrypt('top secret', 'a')
    const cases = [
      new Uint8Array(0),
      new Uint8Array([1]),
      blob.slice(0, 40),
      blob.slice(0, blob.length - 1),
      new Uint8Array([...blob, 0]),
    ]
    for (const c of cases) expect(() => box.decrypt(c, 'a')).toThrow(SecretDecryptError)
  })

  it('rejects another key and uses a fresh nonce every time', async () => {
    const a = await createSecretBox(key)
    const b = await createSecretBox(new Uint8Array(32).fill(8))
    const one = a.encrypt('s', 'a')
    expect(() => b.decrypt(one, 'a')).toThrow(SecretDecryptError)
    expect(Buffer.from(one).equals(Buffer.from(a.encrypt('s', 'a')))).toBe(false)
  })

  it('error message and name carry no detail', async () => {
    const box = await createSecretBox(key)
    const err = (() => {
      try {
        box.decrypt(new Uint8Array(60), 'row:SECRET-AAD')
      } catch (e) {
        return e as Error
      }
    })()
    expect(err?.message).toBe('Failed to decrypt secret')
    expect(err?.stack ?? '').not.toContain('SECRET-AAD')
  })

  it('rejects keys of the wrong length', async () => {
    await expect(createSecretBox(new Uint8Array(31))).rejects.toThrow()
    await expect(createSecretBox(new Uint8Array(0))).rejects.toThrow()
  })

  it('is unaffected by the caller zeroing the key afterwards', async () => {
    const k = new Uint8Array(32).fill(5)
    const box = await createSecretBox(k)
    const blob = box.encrypt('s', 'a')
    k.fill(0)
    expect(box.decrypt(blob, 'a')).toBe('s')
  })
})

describe('startServer edge cases', () => {
  const fakes = () => {
    const close = vi.fn(async () => {})
    const handle = { db: {}, pool: { query: async () => ({}) }, close } as unknown as DbHandle
    return {
      close,
      createDb: vi.fn(() => handle),
      migrate: vi.fn(async () => {}),
      worker: false as const,
      events: false as const,
    }
  }
  const config = (over: object = {}) => ({
    databaseUrl: 'postgres://mawl:s3cr3t-pw@db/mawl',
    host: '127.0.0.1',
    port: 0,
    secretsDir: join(dir, 'secrets'),
    siwcPort: 1455,
    siwcHost: '127.0.0.1',
    logLevel: 'silent' as const,
    ...over,
  })

  it('stop() twice and concurrently closes the db once', async () => {
    const f = fakes()
    const s = await startServer(config(), { logger: createLogger({ level: 'silent' }), ...f })
    await Promise.all([s.stop(), s.stop()])
    await s.stop()
    expect(f.close).toHaveBeenCalledTimes(1)
  })

  it('does not touch the database when the key file is bad', async () => {
    const f = fakes()
    await mkdir(join(dir, 'secrets'))
    await writeFile(join(dir, 'secrets', 'master.key'), '')
    await expect(
      startServer(config(), { logger: createLogger({ level: 'silent' }), ...f }),
    ).rejects.toThrow(/32 bytes/)
    expect(f.createDb).not.toHaveBeenCalled()
  })

  it('closes the db and frees the port when the port is taken', async () => {
    const f = fakes()
    const first = await startServer(config({ secretsDir: join(dir, 'a') }), {
      logger: createLogger({ level: 'silent' }),
      ...fakes(),
    })
    try {
      const port = Number(new URL(first.url).port)
      await expect(
        startServer(config({ port, secretsDir: join(dir, 'b') }), {
          logger: createLogger({ level: 'silent' }),
          ...f,
        }),
      ).rejects.toThrow()
      expect(f.close).toHaveBeenCalledTimes(1)
    } finally {
      await first.stop()
    }
  })
})
