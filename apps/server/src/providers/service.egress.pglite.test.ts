import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { migrationsFolder, schema } from '@mawl/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import type { ResolveHost } from './egress/guarded-fetch.ts'
import {
  createProviderService,
  type ProviderService,
  type ProviderServiceDeps,
  ProviderTestRateLimitedError,
} from './service.ts'

describe('providers.test egress guard and rate limit (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  let db: ProviderServiceDeps['db']
  let box: ProviderServiceDeps['secretBox']
  let requests: string[]
  let dns: Record<string, string[]>
  let resolveHost: ReturnType<typeof vi.fn<ResolveHost>>
  let clock: number

  beforeAll(async () => {
    const d = drizzle(client, { schema })
    await migrate(d, { migrationsFolder })
    db = d
    box = await createSecretBox(new Uint8Array(randomBytes(32)))
  }, 60_000)
  afterAll(() => client.close())

  beforeEach(() => {
    requests = []
    dns = {}
    clock = 0
    resolveHost = vi.fn<ResolveHost>(async (host) =>
      (dns[host] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
    )
  })

  const make = (over: Partial<ProviderServiceDeps> = {}): ProviderService =>
    createProviderService({
      db,
      secretBox: box,
      logger: createLogger({ level: 'silent' }),
      fetch: (async (url: string | URL | Request) => {
        requests.push(String(url))
        return new Response(null, { status: 200 })
      }) as typeof globalThis.fetch,
      resolveHost,
      testRateLimit: { now: () => clock },
      ...over,
    })

  const ollama = (baseUrl?: string, allowPrivateNetwork?: boolean) => ({
    provider: 'ollama' as const,
    label: 'Ollama',
    ...(baseUrl ? { baseUrl } : {}),
    ...(allowPrivateNetwork === undefined ? {} : { allowPrivateNetwork }),
  })

  it.each([
    'http://169.254.169.254',
    'http://[fd00:ec2::254]',
    'http://[::ffff:169.254.169.254]',
    'http://0.0.0.0:11434',
  ])('refuses the metadata or link-local address %s even with the opt-in', async (baseUrl) => {
    const service = make()
    expect(await service.test(ollama(baseUrl, true))).toEqual({
      ok: false,
      reason: 'blocked_address',
    })
    expect(requests).toEqual([])
  })

  it('refuses a name that resolves to a metadata address, asking DNS once', async () => {
    dns['metadata.evil.example'] = ['169.254.169.254']
    const service = make()
    const result = await service.test({
      provider: 'openai_compatible',
      label: 'x',
      baseUrl: 'http://metadata.evil.example/v1',
      allowPrivateNetwork: true,
    })
    expect(result).toEqual({ ok: false, reason: 'blocked_address' })
    expect(resolveHost).toHaveBeenCalledTimes(1)
    expect(requests).toEqual([])
  })

  it('tests a LAN address only with the owner opt-in', async () => {
    const service = make()
    expect(await service.test(ollama('http://192.168.1.20:11434'))).toEqual({
      ok: false,
      reason: 'blocked_address',
    })
    expect(requests).toEqual([])
    expect(await service.test(ollama('http://192.168.1.20:11434', true))).toMatchObject({
      ok: true,
    })
    expect(requests).toEqual(['http://192.168.1.20:11434/api/tags'])
  })

  it('keeps the localhost Ollama default working without the opt-in, typed or not', async () => {
    const service = make()
    expect(await service.test(ollama())).toMatchObject({ ok: true })
    expect(await service.test(ollama('http://localhost:11434'))).toMatchObject({ ok: true })
    expect(requests).toEqual(['http://localhost:11434/api/tags', 'http://localhost:11434/api/tags'])
    expect(resolveHost).not.toHaveBeenCalled()
  })

  it('refuses redirects on both paths: the default url and an owner-typed one', async () => {
    const redirects: (RequestRedirect | undefined)[] = []
    dns['llm.example.com'] = ['93.184.215.14']
    const service = make({
      fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
        redirects.push(init?.redirect)
        return new Response(null, { status: 200 })
      }) as typeof globalThis.fetch,
    })
    await service.test(ollama())
    await service.test({
      provider: 'openai_compatible',
      label: 'x',
      baseUrl: 'https://llm.example.com/v1',
    })
    expect(redirects).toEqual(['error', 'error'])
  })

  it('tests a public address that resolves publicly', async () => {
    dns['llm.example.com'] = ['93.184.215.14']
    const service = make()
    expect(
      await service.test({
        provider: 'openai_compatible',
        label: 'x',
        baseUrl: 'https://llm.example.com/v1',
      }),
    ).toMatchObject({ ok: true })
    expect(requests).toEqual(['https://llm.example.com/v1/models'])
  })

  it('a stored credential keeps its private address (the owner saved it) but never a blocked one', async () => {
    const service = make()
    const lan = await service.create({
      provider: 'openai_compatible',
      label: 'lan',
      baseUrl: 'http://10.0.0.5:8080/v1',
    })
    const meta = await service.create({
      provider: 'openai_compatible',
      label: 'meta',
      baseUrl: 'http://169.254.169.254/v1',
    })
    expect(await service.test({ id: lan.id })).toMatchObject({ ok: true })
    expect(await service.test({ id: meta.id, allowPrivateNetwork: true })).toEqual({
      ok: false,
      reason: 'blocked_address',
    })
    expect(requests).toEqual(['http://10.0.0.5:8080/v1/models'])
  })

  it('rate-limits tests per process with a small token bucket, refilling over time', async () => {
    const service = make({ testRateLimit: { capacity: 3, refillMs: 1000, now: () => clock } })
    for (let i = 0; i < 3; i++) await service.test(ollama())
    await expect(service.test(ollama())).rejects.toBeInstanceOf(ProviderTestRateLimitedError)
    // Refused before any work: no request, no DNS.
    expect(requests).toHaveLength(3)
    clock += 999
    await expect(
      service.test({ id: 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as never }),
    ).rejects.toBeInstanceOf(ProviderTestRateLimitedError)
    clock += 1
    await service.test(ollama())
    expect(requests).toHaveLength(4)
  })

  it('the default bucket allows a burst of 10', async () => {
    const service = make()
    for (let i = 0; i < 10; i++) await service.test(ollama())
    await expect(service.test(ollama())).rejects.toBeInstanceOf(ProviderTestRateLimitedError)
  })
})
