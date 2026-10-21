import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'
import { createLogger } from './logger.ts'
import { unusedProviders } from './providers/test-util.ts'
import { unusedRuns } from './runs/test-util.ts'
import { resolveWebDir } from './web-static.ts'

const INDEX = '<!doctype html><div id="root"></div>'
const HTML = { accept: 'text/html,application/xhtml+xml' }

describe('serving the web build', () => {
  let base: string
  let webDir: string

  beforeAll(async () => {
    base = await mkdtemp(join(tmpdir(), 'mawl-web-'))
    webDir = join(base, 'web')
    await mkdir(join(webDir, 'assets'), { recursive: true })
    await writeFile(join(webDir, 'index.html'), INDEX)
    await writeFile(join(webDir, 'favicon.svg'), '<svg/>')
    await writeFile(join(webDir, 'assets', 'app-abc123.js'), 'console.log(1)')
    await writeFile(join(webDir, '.hidden'), 'hidden')
    await writeFile(join(base, 'secret.txt'), 'outside-the-web-dir')
  })

  afterAll(async () => {
    await rm(base, { recursive: true, force: true })
  })

  function appFor(
    dir: string | undefined = webDir,
    hosts = { bindHost: '0.0.0.0', allowedOrigins: [] as string[] },
  ) {
    return createApp({
      logger: createLogger({ level: 'silent' }),
      version: '1.0.0',
      providers: unusedProviders,
      runs: unusedRuns,
      checkDb: async () => {},
      hosts,
      ...(dir ? { webDir: dir } : {}),
    })
  }

  it('serves index.html at / with no-cache and the hardening headers', async () => {
    const res = await appFor().request('/', { headers: { host: 'localhost:7420' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'")
  })

  it('serves hashed assets as immutable for a year', async () => {
    const res = await appFor().request('/assets/app-abc123.js', {
      headers: { host: 'localhost:7420' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('console.log(1)')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves other files with revalidation', async () => {
    const res = await appFor().request('/favicon.svg', { headers: { host: 'localhost' } })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('answers HEAD without a body', async () => {
    const res = await appFor().request('/', { method: 'HEAD', headers: { host: 'localhost' } })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('')
  })

  it('falls back to index.html for SPA routes a browser navigates to', async () => {
    const res = await appFor().request('/settings/providers', {
      headers: { ...HTML, host: 'localhost' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
    expect(res.headers.get('cache-control')).toBe('no-cache')
  })

  it('returns 404 for an unknown path when the client does not accept html', async () => {
    const res = await appFor().request('/t', {
      headers: { accept: 'application/json', host: 'localhost' },
    })
    expect(res.status).toBe(404)
  })

  it('returns 404, not index.html, for a missing asset or a missing file with an extension', async () => {
    const app = appFor()
    for (const path of ['/assets/missing.js', '/assets/', '/nope.png']) {
      const res = await app.request(path, { headers: { ...HTML, host: 'localhost' } })
      expect(res.status, path).toBe(404)
      expect(await res.text(), path).not.toContain('id="root"')
    }
  })

  it('never shadows /rpc, /healthz or /ws', async () => {
    const app = appFor()
    const health = await app.request('/healthz', { headers: { ...HTML, host: 'localhost' } })
    expect(await health.json()).toEqual({ ok: true })
    const rpc = await app.request('/rpc/nothing/here', { headers: { ...HTML, host: 'localhost' } })
    expect(rpc.status).toBe(404)
    expect(await rpc.text()).not.toContain('id="root"')
    const ws = await app.request('/ws', { headers: { ...HTML, host: 'localhost' } })
    expect(ws.status).toBe(404)
    expect(await ws.text()).not.toContain('id="root"')
  })

  it('does not serve other methods', async () => {
    const res = await appFor().request('/', { method: 'POST', headers: { host: 'localhost' } })
    expect(res.status).toBe(404)
  })

  it.each([
    ['dot-dot with encoded dots', '/%2e%2e/secret.txt'],
    ['dot-dot with encoded slash', '/..%2fsecret.txt'],
    ['mixed-case encoding', '/%2E%2e/secret.txt'],
    ['backslashes', '/..%5csecret.txt'],
    ['raw backslashes', '/assets\\..\\..\\secret.txt'],
    ['encoded in assets', '/assets/%2e%2e/%2e%2e/secret.txt'],
    ['a dotfile', '/.hidden'],
    ['a double slash', '//secret.txt'],
    ['a leading dot-dot', '/../secret.txt'],
    ['a dotenv file', '/.env'],
  ])('never serves files outside the web dir or hidden files: %s', async (_name, path) => {
    const res = await appFor().request(path, { headers: { ...HTML, host: 'localhost' } })
    const body = await res.text()
    expect(body).not.toContain('outside-the-web-dir')
    expect(body).not.toContain('hidden')
    expect(res.status).toBe(404)
  })

  it('collapses /assets/../index.html to the index and never leaves the web dir', async () => {
    const res = await appFor().request('/assets/../index.html', {
      headers: { ...HTML, host: 'localhost' },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(INDEX)
  })

  // A directory link (a junction on Windows, which needs no privileges) from inside the web dir to
  // a directory outside it. serveStatic would follow it, so the handler checks the real path.
  it('refuses a link inside the web dir that points outside it', async () => {
    const outside = join(base, 'outside')
    await mkdir(outside, { recursive: true })
    await writeFile(join(outside, 'leak.txt'), 'outside-the-web-dir')
    await symlink(outside, join(webDir, 'linked'), 'junction')
    const res = await appFor().request('/linked/leak.txt', {
      headers: { ...HTML, host: 'localhost' },
    })
    expect(await res.text()).not.toContain('outside-the-web-dir')
    expect(res.status).toBe(404)
  })
  it('applies the Host allowlist to static files too', async () => {
    const app = appFor()
    const bad = await app.request('/', { headers: { host: 'evil.example' } })
    expect(bad.status).toBe(403)
    expect(await bad.json()).toEqual({ ok: false })
    const good = await app.request('/', { headers: { host: '127.0.0.1:7420' } })
    expect(good.status).toBe(200)
  })

  it('serves nothing when no web dir is configured', async () => {
    const res = await appFor('').request('/', { headers: { ...HTML, host: 'localhost' } })
    expect(res.status).toBe(404)
  })
})

describe('resolveWebDir', () => {
  it('prefers the configured directory', () => {
    expect(resolveWebDir('/srv/web', () => true)).toBe('/srv/web')
  })

  it('uses a web directory beside the bundle when it holds an index.html', () => {
    const dir = resolveWebDir(undefined, (p) => p.endsWith('index.html'))
    expect(dir).toMatch(/web$/)
  })

  it('is undefined when there is neither', () => {
    expect(resolveWebDir(undefined, () => false)).toBeUndefined()
  })
})
