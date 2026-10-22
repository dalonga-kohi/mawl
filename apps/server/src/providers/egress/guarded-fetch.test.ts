import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createGuardedFetch,
  EgressBlockedError,
  type PinnedTransport,
  type ResolveHost,
} from './guarded-fetch.ts'

const answers =
  (...addresses: string[]): ResolveHost =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }))

/** A transport that records where it would connect, without any network. */
function recorder() {
  const calls: { url: string; address: string }[] = []
  const transport: PinnedTransport = async (url, _init, address) => {
    calls.push({ url: url.toString(), address })
    return new Response(null, { status: 204 })
  }
  return { calls, transport }
}

describe('createGuardedFetch policy', () => {
  it('resolves the name once and sends the request to that address', async () => {
    const resolve = vi.fn(answers('93.184.215.14'))
    const { calls, transport } = recorder()
    const res = await createGuardedFetch({ allowPrivate: false, resolve, transport })(
      'https://api.example.com/v1/models',
    )
    expect(res.status).toBe(204)
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(resolve).toHaveBeenCalledWith('api.example.com')
    expect(calls).toEqual([{ url: 'https://api.example.com/v1/models', address: '93.184.215.14' }])
  })

  it.each([
    ['metadata by name', 'http://metadata.example/latest', answers('169.254.169.254')],
    ['metadata by IPv6 name', 'http://metadata.example/', answers('fd00:ec2::254')],
    ['a mapped metadata address', 'http://m.example/', answers('::ffff:169.254.169.254')],
    ['0.0.0.0', 'http://zero.example/', answers('0.0.0.0')],
  ])('refuses %s even with the private opt-in, before connecting', async (_n, url, resolve) => {
    const { calls, transport } = recorder()
    const guarded = createGuardedFetch({ allowPrivate: true, resolve, transport })
    await expect(guarded(url)).rejects.toMatchObject({ name: 'EgressBlockedError', why: 'blocked' })
    expect(calls).toEqual([])
  })

  it.each([
    'http://169.254.169.254/latest/meta-data',
    'http://[fd00:ec2::254]/',
    'http://[::ffff:a9fe:a9fe]/',
    'http://0.0.0.0:11434/',
  ])('refuses the literal %s without asking DNS', async (url) => {
    const resolve = vi.fn(answers('1.1.1.1'))
    const { calls, transport } = recorder()
    const guarded = createGuardedFetch({ allowPrivate: true, resolve, transport })
    await expect(guarded(url)).rejects.toBeInstanceOf(EgressBlockedError)
    expect(resolve).not.toHaveBeenCalled()
    expect(calls).toEqual([])
  })

  it('refuses a private address without the opt-in and allows it with it', async () => {
    const { calls, transport } = recorder()
    const resolve = answers('192.168.1.20')
    await expect(
      createGuardedFetch({ allowPrivate: false, resolve, transport })('http://ollama.lan:11434/'),
    ).rejects.toMatchObject({ why: 'private' })
    expect(calls).toEqual([])
    await createGuardedFetch({ allowPrivate: true, resolve, transport })('http://ollama.lan:11434/')
    expect(calls).toEqual([{ url: 'http://ollama.lan:11434/', address: '192.168.1.20' }])
  })

  it('refuses a name when any of its answers is not allowed (no round-robin escape)', async () => {
    const { calls, transport } = recorder()
    const guarded = createGuardedFetch({
      allowPrivate: false,
      resolve: answers('93.184.215.14', '127.0.0.1'),
      transport,
    })
    await expect(guarded('http://mixed.example/')).rejects.toMatchObject({ why: 'private' })
    expect(calls).toEqual([])
  })

  it('treats a name that resolves to nothing as a network failure, not a block', async () => {
    const { transport } = recorder()
    const guarded = createGuardedFetch({ allowPrivate: false, resolve: answers(), transport })
    const err = await guarded('http://nothing.example/').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(TypeError)
  })

  it('takes a literal address as it is', async () => {
    const resolve = vi.fn(answers('1.1.1.1'))
    const { calls, transport } = recorder()
    await createGuardedFetch({ allowPrivate: true, resolve, transport })('http://[::1]:11434/x')
    expect(resolve).not.toHaveBeenCalled()
    expect(calls).toEqual([{ url: 'http://[::1]:11434/x', address: '::1' }])
  })
})

describe('createGuardedFetch default transport (pinned connect)', () => {
  let server: Server
  let port: number
  const seen: { url: string | undefined; headers: IncomingHttpHeaders }[] = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ url: req.url, headers: req.headers })
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/' }).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json', 'x-reply': 'yes' }).end('{"ok":1}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('connects to the resolved address while keeping the name in Host', async () => {
    // `ollama.invalid` cannot resolve anywhere: the request only arrives because it is pinned.
    const resolve = vi.fn(answers('127.0.0.1'))
    const guarded = createGuardedFetch({ allowPrivate: true, resolve })
    const res = await guarded(`http://ollama.invalid:${port}/api/tags`, {
      headers: { authorization: 'Bearer k' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-reply')).toBe('yes')
    expect(await res.json()).toEqual({ ok: 1 })
    expect(seen.at(-1)).toMatchObject({
      url: '/api/tags',
      headers: { host: `ollama.invalid:${port}`, authorization: 'Bearer k' },
    })
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('never follows a redirect, and fails on one when asked to', async () => {
    const guarded = createGuardedFetch({ allowPrivate: true, resolve: answers('127.0.0.1') })
    const before = seen.length
    await expect(
      guarded(`http://redirect.invalid:${port}/redirect`, { redirect: 'error' }),
    ).rejects.toBeInstanceOf(TypeError)
    const manual = await guarded(`http://redirect.invalid:${port}/redirect`, { redirect: 'manual' })
    expect(manual.status).toBe(302)
    expect(seen.length - before).toBe(2)
  })

  it('aborts with the signal', async () => {
    const guarded = createGuardedFetch({ allowPrivate: true, resolve: answers('127.0.0.1') })
    const ctl = new AbortController()
    ctl.abort()
    await expect(guarded(`http://a.invalid:${port}/`, { signal: ctl.signal })).rejects.toThrow()
  })
})
