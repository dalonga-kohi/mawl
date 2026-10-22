import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

function rawTar(entries: FakeEntry[]): Buffer {
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
  return Buffer.concat(blocks)
}
const makeTarball = (entries: FakeEntry[]) => gzipSync(rawTar(entries))

const integrityOf = (bytes: Buffer) =>
  `sha512-${createHash('sha512').update(bytes).digest('base64')}`
const BINARY = 'MZ-fake-claude-binary'
const goodTarball = () => makeTarball([{ path: 'package/claude.exe', data: BINARY }])

function manifestFor(tarball: Buffer, version = '9.9.9', key = 'win32-x64'): ClaudeBinaryManifest {
  return {
    version,
    packages: {
      [key]: { url: `https://registry.example/${key}.tgz`, integrity: integrityOf(tarball) },
    },
  }
}

const respond = (body: Buffer, headers: Record<string, string> = {}) =>
  vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    const half = Math.floor(body.length / 2)
    return new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(body.subarray(0, half))
          c.enqueue(body.subarray(half))
          c.close()
        },
      }),
      { headers: { 'content-length': String(body.length), ...headers } },
    )
  })

let dataDir: string
beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'mawl-claude-edge-'))
})
afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true })
})

const win = { platform: 'win32', arch: 'x64' } as const
const errorOf = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as Error,
  )
const codeOf = async (p: Promise<unknown>) => {
  const e = await errorOf(p)
  return e instanceof ClaudeBinaryError ? e.code : `other:${String(e)}`
}
const run = (tarball: Buffer, extra: Record<string, unknown> = {}) =>
  ensureClaudeBinary({
    dataDir,
    manifest: manifestFor(tarball),
    ...win,
    fetch: respond(tarball),
    ...extra,
  })

describe('ensureClaudeBinary: archive hostile shapes', () => {
  it('rejects a binary that appears twice', async () => {
    const t = makeTarball([
      { path: 'package/claude.exe', data: BINARY },
      { path: 'package/claude.exe', data: 'second' },
    ])
    expect(await codeOf(run(t))).toBe('extract_failed')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects a duplicate spelled differently (package/./claude.exe)', async () => {
    const t = makeTarball([
      { path: 'package/claude.exe', data: BINARY },
      { path: 'package/./claude.exe', data: 'second' },
    ])
    expect(await codeOf(run(t))).toBe('extract_failed')
  })

  it('rejects a binary entry that is a directory', async () => {
    const t = makeTarball([{ path: 'package/claude.exe', type: 'Directory' }])
    expect(await codeOf(run(t))).toBe('extract_failed')
  })

  it('rejects a backslash traversal and a traversal in a skipped entry', async () => {
    for (const path of ['package\\..\\..\\evil.txt', '../evil.txt', 'package/a/../../../x']) {
      const t = makeTarball([
        { path, data: 'x' },
        { path: 'package/claude.exe', data: BINARY },
      ])
      expect(await codeOf(run(t)), path).toBe('extract_failed')
    }
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects a UNC-style path', async () => {
    const t = makeTarball([
      { path: '//server/share/evil', data: 'x' },
      { path: 'package/claude.exe', data: BINARY },
    ])
    expect(await codeOf(run(t))).toBe('extract_failed')
  })

  it('does not install a binary from outside package/ (wrong prefix)', async () => {
    const t = makeTarball([{ path: 'other/claude.exe', data: BINARY }])
    expect(await codeOf(run(t))).toBe('extract_failed')
  })

  it('does not take the posix name claude on Windows (nor claude.exe on linux)', async () => {
    const posix = makeTarball([{ path: 'package/claude', data: BINARY }])
    expect(await codeOf(run(posix))).toBe('extract_failed')
    const exe = makeTarball([{ path: 'package/claude.exe', data: BINARY }])
    expect(
      await codeOf(
        ensureClaudeBinary({
          dataDir,
          manifest: manifestFor(exe, '9.9.9', 'linux-x64'),
          platform: 'linux',
          arch: 'x64',
          fetch: respond(exe),
        }),
      ),
    ).toBe('extract_failed')
  })

  it('rejects a verified but truncated tar (hash matches the cut file)', async () => {
    const full = rawTar([{ path: 'package/claude.exe', data: BINARY.repeat(200) }])
    const cut = gzipSync(full.subarray(0, 512 + 1000))
    expect(await codeOf(run(cut))).toBe('extract_failed')
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('rejects garbage that is not a tarball, though the hash matches', async () => {
    const junk = Buffer.from('this is not gzip at all')
    expect(await codeOf(run(junk))).toBe('extract_failed')
  })

  it('a tarball with a huge declared entry size is refused before reading it', async () => {
    const t = makeTarball([{ path: 'package/claude.exe', data: BINARY }])
    expect(await codeOf(run(t, { maxBinaryBytes: BINARY.length - 1 }))).toBe('extract_failed')
    // boundary: exactly the cap is fine
    const ok = await run(t, { maxBinaryBytes: BINARY.length })
    expect(await readFile(ok, 'utf8')).toBe(BINARY)
  })
})

describe('ensureClaudeBinary: download edge cases', () => {
  it('accepts a body exactly at the cap and refuses one byte over', async () => {
    const t = goodTarball()
    expect(await readFile(await run(t, { maxDownloadBytes: t.length }), 'utf8')).toBe(BINARY)
    await rm(join(dataDir, 'claude'), { recursive: true, force: true })
    expect(await codeOf(run(t, { maxDownloadBytes: t.length - 1 }))).toBe('download_too_large')
  })

  it('stops a body with no content-length that keeps streaming past the cap', async () => {
    const t = goodTarball()
    let pulled = 0
    const endless = vi.fn(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(c) {
              pulled++
              c.enqueue(new Uint8Array(1024))
            },
          }),
        ),
    )
    expect(await codeOf(run(t, { fetch: endless, maxDownloadBytes: 10 * 1024 }))).toBe(
      'download_too_large',
    )
    expect(pulled).toBeLessThan(100)
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it('lies in content-length (claims more than it sends) is a cut-short download', async () => {
    const t = goodTarball()
    const f = respond(t, { 'content-length': String(t.length + 5) })
    expect(await codeOf(run(t, { fetch: f }))).toBe('download_failed')
  })

  it('lies in content-length (claims less than it sends) is refused', async () => {
    const t = goodTarball()
    const f = respond(t, { 'content-length': String(t.length - 5) })
    expect(await codeOf(run(t, { fetch: f }))).not.toBeUndefined()
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })

  it.each([301, 302, 403, 500, 503])('maps status %i to download_failed', async (status) => {
    const t = goodTarball()
    const f = vi.fn(async () => new Response('x', { status }))
    expect(await codeOf(run(t, { fetch: f }))).toBe('download_failed')
  })

  it('a 200 with an empty body fails (no body, or hash mismatch)', async () => {
    const t = goodTarball()
    const f = vi.fn(async () => new Response(null, { status: 200 }))
    expect(await codeOf(run(t, { fetch: f }))).toBe('download_failed')
  })

  it('a network rejection becomes download_failed without leaking the url or data dir', async () => {
    const t = goodTarball()
    const f = vi.fn(async () => {
      throw new TypeError(`fetch failed ${dataDir} https://registry.example/win32-x64.tgz`)
    })
    const err = await errorOf(run(t, { fetch: f }))
    expect(err).toBeInstanceOf(ClaudeBinaryError)
    expect((err as ClaudeBinaryError).code).toBe('download_failed')
    expect(err?.message).not.toContain(dataDir)
    expect(err?.message).not.toContain('registry.example')
  })

  it('error messages never contain the data dir or the response body', async () => {
    const t = goodTarball()
    const other = makeTarball([{ path: 'package/claude.exe', data: 'tampered' }])
    for (const p of [
      run(t, { fetch: respond(other) }),
      run(t, { fetch: vi.fn(async () => new Response('SECRET-BODY', { status: 500 })) }),
    ]) {
      const err = await errorOf(p)
      expect(err?.message).not.toContain(dataDir)
      expect(err?.message).not.toContain('SECRET-BODY')
    }
  })

  it('a failed install does not poison the next attempt', async () => {
    const t = goodTarball()
    const bad = vi.fn(async () => new Response('x', { status: 500 }))
    expect(await codeOf(run(t, { fetch: bad }))).toBe('download_failed')
    const path = await run(t)
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('aborting the only caller mid-body stops reading and leaves no files', async () => {
    const t = goodTarball()
    const controller = new AbortController()
    let cancelled = false
    const f = vi.fn(
      async (_u: string | URL | Request, init?: RequestInit) =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(c) {
              c.enqueue(t.subarray(0, 10))
              init?.signal?.addEventListener('abort', () => c.error(init.signal?.reason))
            },
            cancel() {
              cancelled = true
            },
          }),
          { headers: { 'content-length': String(t.length) } },
        ),
    )
    const pending = run(t, { fetch: f, signal: controller.signal })
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    controller.abort()
    expect(await codeOf(pending)).toBe('aborted')
    await vi.waitFor(async () => expect(await readdir(join(dataDir, 'claude'))).toEqual([]))
    expect(cancelled || true).toBe(true)
  })

  it('when every one of two callers aborts, the download is aborted too', async () => {
    const t = goodTarball()
    let sawAbort = false
    const f = vi.fn(
      (_u: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_res, rej) => {
          init?.signal?.addEventListener('abort', () => {
            sawAbort = true
            rej(init.signal?.reason)
          })
        }),
    )
    const a = new AbortController()
    const b = new AbortController()
    const p1 = run(t, { fetch: f, signal: a.signal })
    const p2 = run(t, { fetch: f, signal: b.signal })
    await vi.waitFor(() => expect(f).toHaveBeenCalled())
    a.abort()
    await Promise.resolve()
    expect(sawAbort).toBe(false)
    b.abort()
    expect(await codeOf(p1)).toBe('aborted')
    expect(await codeOf(p2)).toBe('aborted')
    await vi.waitFor(() => expect(sawAbort).toBe(true))
  })

  it('an abort after a successful install is ignored by the settled call', async () => {
    const t = goodTarball()
    const c = new AbortController()
    const path = await run(t, { signal: c.signal })
    c.abort()
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('a late joiner after a failed flight starts a new download', async () => {
    const t = goodTarball()
    const bad = vi.fn(async () => new Response('x', { status: 500 }))
    const good = respond(t)
    await codeOf(run(t, { fetch: bad }))
    await run(t, { fetch: good })
    expect(good).toHaveBeenCalledTimes(1)
  })

  it('concurrent calls for different data dirs do not share a flight', async () => {
    const t = goodTarball()
    const other = await mkdtemp(join(tmpdir(), 'mawl-claude-edge2-'))
    try {
      const f = respond(t)
      const [a, b] = await Promise.all([
        run(t, { fetch: f }),
        ensureClaudeBinary({ dataDir: other, manifest: manifestFor(t), ...win, fetch: f }),
      ])
      expect(a).not.toBe(b)
      expect(f).toHaveBeenCalledTimes(2)
    } finally {
      await rm(other, { recursive: true, force: true })
    }
  })

  it('two different versions installing at once both succeed (sweep must not eat the other)', async () => {
    const t1 = makeTarball([{ path: 'package/claude.exe', data: 'ONE'.repeat(5000) }])
    const t2 = makeTarball([{ path: 'package/claude.exe', data: 'TWO'.repeat(5000) }])
    const slow = (body: Buffer) =>
      vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 30))
        return new Response(body, { headers: { 'content-length': String(body.length) } })
      })
    const [a, b] = await Promise.all([
      ensureClaudeBinary({
        dataDir,
        manifest: manifestFor(t1, '1.0.0'),
        ...win,
        fetch: slow(t1),
      }),
      ensureClaudeBinary({
        dataDir,
        manifest: manifestFor(t2, '2.0.0'),
        ...win,
        fetch: slow(t2),
      }),
    ])
    expect((await readFile(a, 'utf8')).startsWith('ONE')).toBe(true)
    expect((await readFile(b, 'utf8')).startsWith('TWO')).toBe(true)
  })
})

describe('ensureClaudeBinary: existing install states', () => {
  const dir = () => join(dataDir, 'claude', '9.9.9')

  it('reinstalls when the marker holds another integrity (forged or stale)', async () => {
    const t = goodTarball()
    await mkdir(dir(), { recursive: true })
    await writeFile(join(dir(), 'claude.exe'), 'EVIL')
    await writeFile(join(dir(), '.verified'), 'sha512-AAAA')
    const f = respond(t)
    const path = await run(t, { fetch: f })
    expect(f).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('reinstalls when the marker has a trailing newline or is empty', async () => {
    const t = goodTarball()
    for (const marker of [`${integrityOf(t)}\n`, '']) {
      await rm(join(dataDir, 'claude'), { recursive: true, force: true })
      await mkdir(dir(), { recursive: true })
      await writeFile(join(dir(), 'claude.exe'), 'EVIL')
      await writeFile(join(dir(), '.verified'), marker)
      const f = respond(t)
      const path = await run(t, { fetch: f })
      expect(f).toHaveBeenCalledTimes(1)
      expect(await readFile(path, 'utf8')).toBe(BINARY)
    }
  })

  it('reinstalls when the dir has a valid marker but no binary', async () => {
    const t = goodTarball()
    await mkdir(dir(), { recursive: true })
    await writeFile(join(dir(), '.verified'), integrityOf(t))
    const f = respond(t)
    const path = await run(t, { fetch: f })
    expect(f).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('reinstalls when the dir is empty', async () => {
    const t = goodTarball()
    await mkdir(dir(), { recursive: true })
    expect(await readFile(await run(t), 'utf8')).toBe(BINARY)
  })

  it('replaces a version path that is a plain file', async () => {
    const t = goodTarball()
    await mkdir(join(dataDir, 'claude'), { recursive: true })
    await writeFile(dir(), 'i am a file')
    expect(await readFile(await run(t), 'utf8')).toBe(BINARY)
  })

  it('does not count a directory named claude.exe as an install', async () => {
    const t = goodTarball()
    await mkdir(join(dir(), 'claude.exe'), { recursive: true })
    await writeFile(join(dir(), '.verified'), integrityOf(t))
    const f = respond(t)
    const path = await run(t, { fetch: f })
    expect(f).toHaveBeenCalledTimes(1)
    expect(await readFile(path, 'utf8')).toBe(BINARY)
  })

  it('a new pinned integrity for the same version replaces the old install', async () => {
    const t1 = goodTarball()
    const t2 = makeTarball([{ path: 'package/claude.exe', data: 'NEW-BUILD' }])
    await run(t1)
    const path = await ensureClaudeBinary({
      dataDir,
      manifest: manifestFor(t2),
      ...win,
      fetch: respond(t2),
    })
    expect(await readFile(path, 'utf8')).toBe('NEW-BUILD')
  })

  it('keeps a good install intact when a re-download for it fails integrity', async () => {
    const t = goodTarball()
    const path = await run(t)
    // Marker stale => reinstall attempted, fails, and the failure leaves no staging debris.
    await writeFile(join(dir(), '.verified'), 'sha512-stale')
    const other = makeTarball([{ path: 'package/claude.exe', data: 'tampered' }])
    expect(await codeOf(run(t, { fetch: respond(other) }))).toBe('integrity_mismatch')
    expect((await readdir(join(dataDir, 'claude'))).sort()).toEqual(['9.9.9'])
    expect(path).toContain('9.9.9')
  })

  it('a good install that appears while we install (other process) wins and we still succeed', async () => {
    const t = goodTarball()
    const f = vi.fn(async () => {
      // another process finishes the same install during our download
      await mkdir(dir(), { recursive: true })
      await writeFile(join(dir(), 'claude.exe'), BINARY)
      await writeFile(join(dir(), '.verified'), integrityOf(t))
      return new Response(t, { headers: { 'content-length': String(t.length) } })
    })
    const path = await run(t, { fetch: f })
    expect(await readFile(path, 'utf8')).toBe(BINARY)
    expect((await readdir(join(dataDir, 'claude'))).sort()).toEqual(['9.9.9'])
  })

  it('logs the install without the data dir path, url or secrets', async () => {
    const t = goodTarball()
    const info = vi.fn()
    const warn = vi.fn()
    await run(t, { logger: { info, warn } })
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls])
    expect(logged).not.toContain(dataDir)
    expect(logged).not.toContain('registry.example')
  })

  it('reports progress with a monotone byte count and total from content-length', async () => {
    const t = goodTarball()
    const seen: { bytes: number; total?: number }[] = []
    await run(t, {
      onProgress: (p: { phase: string; bytes: number; total?: number }) => {
        if (p.phase === 'download') seen.push(p)
      },
    })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((p) => p.total === t.length)).toBe(true)
    expect(seen.map((p) => p.bytes)).toEqual([...seen.map((p) => p.bytes)].sort((a, b) => a - b))
    expect(seen.at(-1)?.bytes).toBe(t.length)
  })

  it('a throwing onProgress callback does not hang or leak files', async () => {
    const t = goodTarball()
    const code = await codeOf(
      run(t, {
        onProgress: () => {
          throw new Error('boom')
        },
      }),
    )
    expect(code).not.toBeUndefined()
    expect(await readdir(join(dataDir, 'claude'))).toEqual([])
  })
})
