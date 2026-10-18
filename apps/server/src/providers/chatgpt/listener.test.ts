import { createServer } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { startLoopbackListener } from './listener.ts'

const open: Array<{ close(): Promise<void> }> = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((l) => l.close()))
})

async function listen(onCallback: (p: URLSearchParams) => void = () => {}) {
  const l = await startLoopbackListener({ host: '127.0.0.1', port: 0, onCallback })
  open.push(l)
  return l
}

const get = (port: number, path: string, init?: RequestInit) =>
  fetch(`http://127.0.0.1:${port}${path}`, init)

describe('loopback listener', () => {
  it('hands the callback query to the handler and answers a static page that echoes nothing', async () => {
    const seen: URLSearchParams[] = []
    const l = await listen((p) => void seen.push(p))
    const res = await get(l.port, '/auth/callback?code=SECRET-CODE&state=SECRET-STATE&error=oops')
    const html = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(html).toContain('You can close this window')
    for (const leak of ['SECRET-CODE', 'SECRET-STATE', 'oops']) expect(html).not.toContain(leak)
    expect(seen).toHaveLength(1)
    expect(seen[0]?.get('code')).toBe('SECRET-CODE')
    expect(seen[0]?.get('state')).toBe('SECRET-STATE')
  })

  it('is one-shot: it closes after the first callback and takes no second one', async () => {
    let calls = 0
    const l = await listen(() => void calls++)
    await (await get(l.port, '/auth/callback?code=a&state=b')).text()
    await expect(get(l.port, '/auth/callback?code=a&state=b')).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('ignores other paths and methods without consuming the attempt', async () => {
    let calls = 0
    const l = await listen(() => void calls++)
    expect((await get(l.port, '/')).status).toBe(404)
    expect((await get(l.port, '/auth/callback/extra')).status).toBe(404)
    expect((await get(l.port, '/auth/callback?code=a', { method: 'POST' })).status).toBe(405)
    expect(calls).toBe(0)
    expect((await get(l.port, '/auth/callback?code=a&state=b')).status).toBe(200)
    expect(calls).toBe(1)
  })

  it('refuses a request whose Host is not 127.0.0.1:<port> (DNS rebinding)', async () => {
    let calls = 0
    const l = await listen(() => void calls++)
    const status = await new Promise<number>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: l.port,
            path: '/auth/callback?code=a&state=b',
            headers: { host: 'evil.example' },
          },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          },
        )
        req.on('error', reject)
        req.end()
      })
    })
    expect(status).toBe(400)
    expect(calls).toBe(0)
  })

  it('answers 400 to a callback that fails the accept check and keeps listening for the real one', async () => {
    const seen: string[] = []
    const l = await startLoopbackListener({
      host: '127.0.0.1',
      port: 0,
      accept: (p) => p.get('state') === 'right',
      onCallback: (p) => void seen.push(p.get('code') ?? ''),
    })
    open.push(l)
    expect((await get(l.port, '/auth/callback?code=x&state=wrong')).status).toBe(400)
    expect((await get(l.port, '/auth/callback?code=x')).status).toBe(400)
    expect(seen).toEqual([])
    expect((await get(l.port, '/auth/callback?code=real&state=right')).status).toBe(200)
    expect(seen).toEqual(['real'])
  })

  it('rejects when the port is already taken', async () => {
    const l = await listen()
    await expect(
      startLoopbackListener({ host: '127.0.0.1', port: l.port, onCallback: () => {} }),
    ).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })

  it('close() is idempotent and frees the port', async () => {
    const l = await listen()
    await l.close()
    await l.close()
    const probe = createServer()
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(l.port, '127.0.0.1', resolve)
    })
    await new Promise<void>((resolve) => probe.close(() => resolve()))
  })

  it('does not let a throwing handler break the page', async () => {
    const l = await listen(() => {
      throw new Error('boom')
    })
    expect((await get(l.port, '/auth/callback?code=a&state=b')).status).toBe(200)
  })
})
