import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { Header } from 'tar'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeBinaryError, ensureClaudeBinary } from './ensure.ts'
import type { ClaudeBinaryManifest } from './manifest.ts'

interface FakeEntry {
  path: string
  data?: string
  type?: 'File' | 'SymbolicLink' | 'Link' | 'Directory'
  linkpath?: string
}

/** A gzip'd tarball with exactly the given entries, header bytes included (no path sanitising). */
function makeTarball(entries: FakeEntry[]): Buffer {
  const blocks: Buffer[] = []
  for (const e of entries) {
    const data = Buffer.from(e.data ?? '')
    const block = Buffer.alloc(512)
    new Header({
      path: e.path,
      type: e.type ?? 'File',
      size: e.type === 'SymbolicLink' || e.type === 'Link' ? 0 : data.length,
      mode: 0o644,
      ...(e.linkpath ? { linkpath: e.linkpath } : {}),
    }).encode(block, 0)
    blocks.push(block)
    if (data.length > 0 && (e.type ?? 'File') === 'File') {
      blocks.push(data, Buffer.alloc((512 - (data.length % 512)) % 512))
    }
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

const integrityOf = (bytes: Buffer) =>
  `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const BINARY = 'MZ-fake-claude-binary'
const goodTarball = () =>
  makeTarball([
    { path: 'package/', type: 'Directory' },
    { path: 'package/package.json', data: '{}' },
    { path: 'package/claude.exe', data: BINARY },
  ])

function manifestFor(tarball: Buffer, key = 'win32-x64'): ClaudeBinaryManifest {
  return {
    version: '9.9.9',
    packages: {
      [key]: { url: `https://registry.example/${key}.tgz`, integrity: integrityOf(tarball) },
    },
  }
}

/** Answers every request with `body`, in two chunks, and counts the calls. */
function fakeFetch(body: Buffer, init: { headers?: Record<string, string>; status?: number } = {}) {
  const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const half = Math.floor(body.length / 2)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(body.subarray(0, half))
        controller.enqueue(body.subarray(half))
        controller.close()
      },
    })
    return new Response(stream, {
      status: init.status ?? 200,
      headers: { 'content-length': String(body.length), ...init.headers },
    })
  })
  return fn
}

let dataDir: string
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mawl-claude-bin-'))
})
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const win = { platform: 'win32', arch: 'x64' } as const
const errorCode = async (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => (e instanceof ClaudeBinaryError ? e.code : `other:${String(e)}`),
  )

describe('ensureClaudeBinary', () => {
  it('downloads, verifies and installs only the binary at <dataDir>/claude/<ver>/claude.exe', async () => {
    const tarball = goodTarball()
    const fetch = fakeFetch(tarball)
    const progress: string[] = []
    const path = await ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(tarball),
      ...win,
      fetch,
      onProgress: (p) => progress.push(p.phase),
    })
    expect(path).toBe(join(dataDir, 'claude', '9.9.9', 'claude.exe'))
    expect(await readFile(path, 'utf8')).toBe(BINARY)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0]?.[0]).toBe('https://registry.example/win32-x64.tgz')
    expect(new Set(progress)).toEqual(new Set(['download', 'verify', 'extract']))
    // No leftovers: no tarball, no staging dir, and package.json was not extracted.
    expect(await readdir(join(dataDir, 'claude'))).toEqual(['9.9.9'])
    expect((await readdir(join(dataDir, 'claude', '9.9.9'))).sort()).toEqual([
      '.verified',
      'claude.exe',
    ])
  })

  it('names the file claude, executable, on non-Windows platforms', async () => {
    const tarball = makeTarball([{ path: 'package/claude', data: BINARY }])
    const path = await ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(tarball, 'linux-x64'),
      platform: 'linux',
      arch: 'x64',
      fetch: fakeFetch(tarball),
    })
    expect(path).toBe(join(dataDir, 'claude', '9.9.9', 'claude'))
    if (process.platform !== 'win32') expect((await stat(path)).mode & 0o111).not.toBe(0)
  })

  it('rejects a tarball whose hash differs, deleting it and extracting nothing', async () => {
    const tarball = goodTarball()
    const other = makeTarball([{ path: 'package/claude.exe', data: 'tampered' }])
    const code = await errorCode(
      ensureClaudeBinary({
        dataDir,
        manifest: manifestFor(tarball),
        ...win,
        fetch: fakeFetch(other),
      }),
    )
    expect(code).toBe('integrity_mismatch')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects a truncated download', async () => {
    const tarball = goodTarball()
    const cut = tarball.subarray(0, tarball.length - 10)
    const fetch = fakeFetch(cut, { headers: { 'content-length': String(tarball.length) } })
    expect(
      await errorCode(
        ensureClaudeBinary({ dataDir, manifest: manifestFor(tarball), ...win, fetch }),
      ),
    ).toBe('download_failed')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects a download that breaks off mid-stream', async () => {
    const tarball = goodTarball()
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(tarball.subarray(0, 20))
              c.error(new Error('socket hang up'))
            },
          }),
        ),
    )
    expect(
      await errorCode(
        ensureClaudeBinary({ dataDir, manifest: manifestFor(tarball), ...win, fetch }),
      ),
    ).toBe('download_failed')
  })

  it('rejects an HTTP error status', async () => {
    const tarball = goodTarball()
    const fetch = fakeFetch(Buffer.from('nope'), { status: 404 })
    expect(
      await errorCode(
        ensureClaudeBinary({ dataDir, manifest: manifestFor(tarball), ...win, fetch }),
      ),
    ).toBe('download_failed')
  })

  it('rejects an oversize download, by header and by bytes received', async () => {
    const tarball = goodTarball()
    const manifest = manifestFor(tarball)
    const byHeader = await errorCode(
      ensureClaudeBinary({
        dataDir,
        manifest,
        ...win,
        fetch: fakeFetch(tarball),
        maxDownloadBytes: tarball.length - 1,
      }),
    )
    expect(byHeader).toBe('download_too_large')
    const noHeader = vi.fn(async () => new Response(tarball)) // content-length unknown
    const byBytes = await errorCode(
      ensureClaudeBinary({
        dataDir,
        manifest,
        ...win,
        fetch: noHeader,
        maxDownloadBytes: tarball.length - 1,
      }),
    )
    expect(byBytes).toBe('download_too_large')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects an entry with a path traversal', async () => {
    const tarball = makeTarball([
      { path: 'package/../../evil.txt', data: 'x' },
      { path: 'package/claude.exe', data: BINARY },
    ])
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch: fakeFetch(tarball),
        }),
      ),
    ).toBe('extract_failed')
    expect(existsSync(join(dataDir, 'evil.txt'))).toBe(false)
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it.each([
    ['an absolute path', { path: '/etc/passwd', data: 'x' }],
    ['a drive path', { path: 'C:/Windows/evil.dll', data: 'x' }],
    ['a symlink', { path: 'package/link', type: 'SymbolicLink', linkpath: '/etc/passwd' }],
    ['a hard link', { path: 'package/hard', type: 'Link', linkpath: 'package/claude.exe' }],
  ] satisfies [string, FakeEntry][])('rejects %s entry', async (_name, entry) => {
    const tarball = makeTarball([entry, { path: 'package/claude.exe', data: BINARY }])
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch: fakeFetch(tarball),
        }),
      ),
    ).toBe('extract_failed')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects a binary entry that is a symlink', async () => {
    const tarball = makeTarball([
      { path: 'package/claude.exe', type: 'SymbolicLink', linkpath: 'C:/Windows/cmd.exe' },
    ])
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch: fakeFetch(tarball),
        }),
      ),
    ).toBe('extract_failed')
  })

  it('fails when the tarball has no binary entry', async () => {
    const tarball = makeTarball([{ path: 'package/package.json', data: '{}' }])
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch: fakeFetch(tarball),
        }),
      ),
    ).toBe('extract_failed')
  })

  it('fails when the unpacked binary would exceed the cap', async () => {
    const tarball = goodTarball()
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch: fakeFetch(tarball),
          maxBinaryBytes: 4,
        }),
      ),
    ).toBe('extract_failed')
  })

  it('returns an existing verified install without any network call', async () => {
    const tarball = goodTarball()
    const manifest = manifestFor(tarball)
    await ensureClaudeBinary({ dataDir, manifest, ...win, fetch: fakeFetch(tarball) })
    const second = vi.fn()
    const path = await ensureClaudeBinary({ dataDir, manifest, ...win, fetch: second })
    expect(path).toBe(join(dataDir, 'claude', '9.9.9', 'claude.exe'))
    expect(second).not.toHaveBeenCalled()
  })

  it('reinstalls when the install has no verified marker', async () => {
    const tarball = goodTarball()
    const dir = join(dataDir, 'claude', '9.9.9')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'claude.exe'), 'half-written')
    const fetch = fakeFetch(tarball)
    const path = await ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(tarball),
      ...win,
      fetch,
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('shares one download between concurrent calls', async () => {
    const tarball = goodTarball()
    const manifest = manifestFor(tarball)
    const fetch = fakeFetch(tarball)
    const [a, b, c] = await Promise.all([
      ensureClaudeBinary({ dataDir, manifest, ...win, fetch }),
      ensureClaudeBinary({ dataDir, manifest, ...win, fetch }),
      ensureClaudeBinary({ dataDir, manifest, ...win, fetch }),
    ])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(new Set([a, b, c]).size).toBe(1)
  })

  it('removes a staging dir and download a crashed run left behind', async () => {
    const tarball = goodTarball()
    const root = join(dataDir, 'claude')
    await mkdir(join(root, '9.9.9.staging-dead'), { recursive: true })
    await writeFile(join(root, '9.9.9.staging-dead', 'claude.exe'), 'partial')
    await writeFile(join(root, '.download-dead.tgz'), 'partial')
    await ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(tarball),
      ...win,
      fetch: fakeFetch(tarball),
    })
    expect(await readdir(root)).toEqual(['9.9.9'])
  })

  it('fails on a platform the build has no package for', async () => {
    const tarball = goodTarball()
    const fetch = fakeFetch(tarball)
    const manifest = manifestFor(tarball)
    expect(
      await errorCode(
        ensureClaudeBinary({ dataDir, manifest, platform: 'freebsd', arch: 'x64', fetch }),
      ),
    ).toBe('unsupported_platform')
    expect(
      await errorCode(
        ensureClaudeBinary({ dataDir, manifest, platform: 'win32', arch: 'arm64', fetch }),
      ),
    ).toBe('unsupported_platform')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('stops the download when the caller aborts', async () => {
    const tarball = goodTarball()
    const controller = new AbortController()
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    const pending = ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(tarball),
      ...win,
      fetch,
      signal: controller.signal,
    })
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    controller.abort()
    expect(await errorCode(pending)).toBe('aborted')
    await vi.waitFor(async () => expect(await readdir(join(dataDir, 'claude'))).toEqual([]))
  })

  it('rejects at once for an already-aborted signal', async () => {
    const tarball = goodTarball()
    const fetch = fakeFetch(tarball)
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch,
          signal: AbortSignal.abort(),
        }),
      ),
    ).toBe('aborted')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps downloading for the others when only one of two callers aborts', async () => {
    const tarball = goodTarball()
    const manifest = manifestFor(tarball)
    const fetch = fakeFetch(tarball)
    const controller = new AbortController()
    const first = ensureClaudeBinary({
      dataDir,
      manifest,
      ...win,
      fetch,
      signal: controller.signal,
    })
    const second = ensureClaudeBinary({ dataDir, manifest, ...win, fetch })
    controller.abort()
    expect(await errorCode(first)).toBe('aborted')
    expect(await readFile(await second, 'utf8')).toBe(BINARY)
  })

  it('times out a stalled download', async () => {
    const tarball = goodTarball()
    const fetch = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    expect(
      await errorCode(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(tarball),
          ...win,
          fetch,
          timeoutMs: 20,
        }),
      ),
    ).toBe('download_failed')
  })
})
