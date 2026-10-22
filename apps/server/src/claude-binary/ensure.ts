import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { join, posix } from 'node:path'
import { finished } from 'node:stream/promises'
import { list } from 'tar'
import { z } from 'zod'
import type { Logger } from '../logger.ts'
import { type ClaudeBinaryManifest, platformKey } from './manifest.ts'
import { retryTransient } from './retry.ts'

export type ClaudeBinaryErrorCode =
  | 'unsupported_platform'
  | 'download_failed'
  | 'download_too_large'
  | 'integrity_mismatch'
  | 'extract_failed'
  | 'aborted'

/** Messages never carry a path or response body: callers may show them to the owner. */
export class ClaudeBinaryError extends Error {
  constructor(
    readonly code: ClaudeBinaryErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'ClaudeBinaryError'
  }
}

export interface ClaudeBinaryProgress {
  phase: 'download' | 'verify' | 'extract'
  bytes: number
  /** Known from content-length during the download only. */
  total?: number
}

export interface EnsureClaudeBinaryOptions {
  /** Mawl's data dir; the binary lands in `<dataDir>/claude/<version>/`. */
  dataDir: string
  manifest: ClaudeBinaryManifest
  platform?: string
  arch?: string
  isMusl?: boolean
  fetch?: typeof globalThis.fetch
  logger?: Pick<Logger, 'info' | 'warn'>
  signal?: AbortSignal
  onProgress?: (progress: ClaudeBinaryProgress) => void
  /** Cap on the tarball. Defaults to 400 MB (the real one is about 126 MB). */
  maxDownloadBytes?: number
  /** Cap on the unpacked binary. Defaults to 1 GiB (the real one is about 277 MB). */
  maxBinaryBytes?: number
  /** Whole-download deadline. Defaults to 10 minutes. */
  timeoutMs?: number
  /** Cap on entries read from the tarball. Defaults to 10 000 (the real one has a handful). */
  maxEntries?: number
}

const DEFAULT_MAX_DOWNLOAD = 400 * 1024 * 1024
const DEFAULT_MAX_BINARY = 1024 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_MAX_ENTRIES = 10_000
const MARKER = '.verified'

const noopLogger = { info: () => {}, warn: () => {} }

interface Flight {
  promise: Promise<string>
  controller: AbortController
  waiters: number
  /** Every caller aborted: the install is winding down and must not take new callers. */
  dying: boolean
}
/** Installs under way in this process, by target directory. */
const flights = new Map<string, Flight>()

/**
 * Returns the absolute path of the unmodified Claude Code binary for this machine, downloading and
 * verifying it first when it is not installed yet. The tarball's sha512 must equal the one the
 * lockfile pinned at build time; nothing is extracted before that check passes.
 *
 * Concurrent calls for the same install share one download. An abort ends that download only when
 * every waiting caller has aborted.
 */
export function ensureClaudeBinary(opts: EnsureClaudeBinaryOptions): Promise<string> {
  const { dataDir, manifest } = opts
  const key = platformKey(
    opts.platform ?? process.platform,
    opts.arch ?? process.arch,
    opts.isMusl ?? false,
  )
  const pkg = key ? manifest.packages[key] : undefined
  if (!key || !pkg) {
    return Promise.reject(
      new ClaudeBinaryError(
        'unsupported_platform',
        `No Claude Code binary is published for ${opts.platform ?? process.platform}-${opts.arch ?? process.arch}`,
      ),
    )
  }
  if (opts.signal?.aborted) {
    return Promise.reject(new ClaudeBinaryError('aborted', 'Claude binary install was cancelled'))
  }
  const isWin = (opts.platform ?? process.platform) === 'win32'
  const root = join(dataDir, 'claude')
  const finalDir = join(root, manifest.version)
  const target = join(finalDir, isWin ? 'claude.exe' : 'claude')

  let flight = flights.get(finalDir)
  if (flight?.dying) {
    // Let the aborted install finish its cleanup, then start (or join) a fresh one.
    return flight.promise.then(
      () => ensureClaudeBinary(opts),
      () => ensureClaudeBinary(opts),
    )
  }
  if (!flight) {
    const controller = new AbortController()
    const created: Flight = {
      controller,
      waiters: 0,
      dying: false,
      promise: installSafely({
        ...opts,
        controller,
        root,
        finalDir,
        target,
        isWin,
        pkg,
        key,
      }).finally(() => {
        if (flights.get(finalDir) === created) flights.delete(finalDir)
      }),
    }
    // Waiters handle the outcome; this keeps an abandoned flight from becoming unhandled.
    created.promise.catch(() => {})
    flights.set(finalDir, created)
    flight = created
  }
  return wait(flight, opts.signal)
}

function wait(flight: Flight, signal: AbortSignal | undefined): Promise<string> {
  flight.waiters++
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const leave = () => {
      if (settled) return false
      settled = true
      signal?.removeEventListener('abort', onAbort)
      flight.waiters--
      return true
    }
    const onAbort = () => {
      if (!leave()) return
      if (flight.waiters === 0) {
        flight.dying = true
        flight.controller.abort()
      }
      reject(new ClaudeBinaryError('aborted', 'Claude binary install was cancelled'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    flight.promise.then(
      (value) => {
        if (leave()) resolve(value)
      },
      (err: unknown) => {
        if (leave()) reject(err)
      },
    )
  })
}

interface InstallContext extends EnsureClaudeBinaryOptions {
  controller: AbortController
  root: string
  finalDir: string
  target: string
  isWin: boolean
  pkg: { url: string; integrity: string }
  key: string
}

/** What `.verified` holds: the tarball integrity the binary came from and the binary's size. */
const Marker = z.strictObject({ integrity: z.string(), size: z.number().int().nonnegative() })

/**
 * True when `<finalDir>` holds a regular file of the size that was verified against this
 * integrity. The binary is not re-hashed (277 MB); the marker and size catch a half-written or
 * swapped file, not a deliberate edit by someone who already owns the data dir.
 */
async function isInstalled({ finalDir, target, pkg }: InstallContext): Promise<boolean> {
  try {
    const marker = Marker.parse(JSON.parse(await readFile(join(finalDir, MARKER), 'utf8')))
    const info = await stat(target)
    return info.isFile() && marker.integrity === pkg.integrity && marker.size === info.size
  } catch {
    return false
  }
}

const cancelled = (cause?: unknown) =>
  new ClaudeBinaryError('aborted', 'Claude binary install was cancelled', { cause })

/** Any failure that is not already typed (fs errors name paths) becomes a generic extract_failed. */
async function installSafely(ctx: InstallContext): Promise<string> {
  try {
    return await install(ctx)
  } catch (err) {
    if (err instanceof ClaudeBinaryError) throw err
    if (ctx.controller.signal.aborted) throw cancelled(err)
    throw new ClaudeBinaryError('extract_failed', 'The Claude binary could not be installed', {
      cause: err,
    })
  }
}

async function install(ctx: InstallContext): Promise<string> {
  if (await isInstalled(ctx)) return ctx.target
  const log = ctx.logger ?? noopLogger
  const started = performance.now()
  const id = createHash('sha256').update(`${process.pid}:${started}:${Math.random()}`).digest('hex')
  const staging = `${ctx.finalDir}.staging-${id.slice(0, 12)}`
  const tarball = join(ctx.root, `.download-${ctx.manifest.version}@${id.slice(0, 12)}.tgz`)

  await mkdir(ctx.root, { recursive: true })
  await sweepLeftovers(ctx.root, ctx.manifest.version)
  try {
    const bytes = await download(ctx, tarball)
    await mkdir(staging, { recursive: true })
    ctx.onProgress?.({ phase: 'extract', bytes })
    if (ctx.controller.signal.aborted) throw cancelled()
    const staged = join(staging, ctx.isWin ? 'claude.exe' : 'claude')
    await extractBinary(ctx, tarball, staged)
    const marker: z.infer<typeof Marker> = {
      integrity: ctx.pkg.integrity,
      size: (await stat(staged)).size,
    }
    await writeFile(join(staging, MARKER), JSON.stringify(marker))
    if (ctx.controller.signal.aborted) throw cancelled()
    // A broken or foreign previous install is replaced; a good one that appeared meanwhile wins.
    // Windows can hold a fresh file for a moment (antivirus, indexer), hence the retries.
    await retryTransient(() => rm(ctx.finalDir, { recursive: true, force: true }))
    try {
      await retryTransient(() => rename(staging, ctx.finalDir))
    } catch (err) {
      if (!(await isInstalled(ctx))) {
        throw new ClaudeBinaryError(
          'extract_failed',
          'Could not move the Claude binary into place',
          {
            cause: err,
          },
        )
      }
    }
    log.info(
      {
        version: ctx.manifest.version,
        platform: ctx.key,
        bytes,
        ms: Math.round(performance.now() - started),
      },
      'claude binary installed',
    )
    return ctx.target
  } finally {
    await rm(tarball, { force: true }).catch(() => {})
    await rm(staging, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Removes the downloads and staging dirs of one version that a crashed run left behind. Other
 * versions' files are never touched, since another install may be using them right now. This
 * assumes one Mawl server per data dir (true in desktop mode: the host allows a single instance);
 * a second process installing the same version into the same dir would have its work deleted.
 * In-process installs of one version never overlap here because `flights` serialises them and a
 * dying flight is awaited before a new one starts.
 */
async function sweepLeftovers(root: string, version: string): Promise<void> {
  for (const name of await readdir(root).catch(() => [])) {
    // `@` cannot occur in a version, so `1.0` never claims the files of `1.0-beta`.
    if (name.startsWith(`.download-${version}@`) || name.startsWith(`${version}.staging-`)) {
      await rm(join(root, name), { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function download(ctx: InstallContext, file: string): Promise<number> {
  const max = ctx.maxDownloadBytes ?? DEFAULT_MAX_DOWNLOAD
  const timeout = AbortSignal.timeout(ctx.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const signal = AbortSignal.any([ctx.controller.signal, timeout])
  const fail = (err: unknown): never => {
    if (err instanceof ClaudeBinaryError) throw err
    if (ctx.controller.signal.aborted) {
      throw new ClaudeBinaryError('aborted', 'Claude binary install was cancelled', { cause: err })
    }
    throw new ClaudeBinaryError(
      'download_failed',
      timeout.aborted
        ? 'The Claude binary download timed out'
        : 'The Claude binary download failed',
      { cause: err },
    )
  }

  const hash = createHash('sha512')
  let received = 0
  const handle = await open(file, 'w')
  try {
    const res = await (ctx.fetch ?? fetch)(ctx.pkg.url, { signal }).catch(fail)
    if (!res.ok || !res.body) {
      throw new ClaudeBinaryError('download_failed', `The registry answered ${res.status}`)
    }
    const declared = Number(res.headers.get('content-length'))
    const total = Number.isFinite(declared) && declared > 0 ? declared : undefined
    if (total !== undefined && total > max) {
      throw new ClaudeBinaryError('download_too_large', 'The Claude binary download is too large')
    }
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        received += chunk.byteLength
        if (received > max) {
          throw new ClaudeBinaryError(
            'download_too_large',
            'The Claude binary download is too large',
          )
        }
        hash.update(chunk)
        await handle.write(chunk)
        ctx.onProgress?.({ phase: 'download', bytes: received, ...(total ? { total } : {}) })
      }
    } catch (err) {
      fail(err)
    }
    // A content-encoded body is decoded on the way in, so its length differs from the header;
    // the sha512 check below still catches any truncation.
    if (total !== undefined && !res.headers.has('content-encoding') && received !== total) {
      throw new ClaudeBinaryError('download_failed', 'The Claude binary download was cut short')
    }
  } finally {
    await handle.close().catch(() => {})
  }
  ctx.onProgress?.({ phase: 'verify', bytes: received })
  if (`sha512-${hash.digest('base64')}` !== ctx.pkg.integrity) {
    throw new ClaudeBinaryError(
      'integrity_mismatch',
      'The downloaded Claude binary does not match the pinned checksum',
    )
  }
  return received
}

class Rejected extends Error {}

const isUnsafePath = (path: string): boolean => {
  const p = path.replaceAll('\\', '/')
  return (
    p.includes('\0') ||
    p.startsWith('/') ||
    /^[a-zA-Z]:/.test(p) ||
    posix.normalize(p).split('/').includes('..') ||
    p.split('/').includes('..')
  )
}

/**
 * Writes `package/claude(.exe)` from the verified tarball to `dest` and nothing else. Entries
 * with an unsafe path, links of any kind or a duplicate binary fail the install; other files in
 * the package (README, package.json) are skipped. The destination is chosen here, never taken
 * from the archive, so no entry can write elsewhere.
 */
async function extractBinary(ctx: InstallContext, tarball: string, dest: string): Promise<void> {
  const wanted = `package/${ctx.isWin ? 'claude.exe' : 'claude'}`
  const maxBinary = ctx.maxBinaryBytes ?? DEFAULT_MAX_BINARY
  let problem: string | undefined
  let written: Promise<void> | undefined
  let expected = 0
  let count = 0
  let seen = 0
  const maxEntries = ctx.maxEntries ?? DEFAULT_MAX_ENTRIES

  try {
    await list({
      file: tarball,
      noResume: true,
      onReadEntry: (entry) => {
        const path = entry.path
        if (problem !== undefined) {
          entry.resume()
          return
        }
        // Inflation of skipped entries is bounded by tar's own decompression-ratio guard (and the
        // 400 MB download cap); this bounds the number of headers walked.
        if (++seen > maxEntries) problem = 'the archive has too many entries'
        else if (isUnsafePath(path)) problem = 'an entry has an unsafe path'
        else if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
          problem = 'the archive contains a link'
        } else if (posix.normalize(path.replaceAll('\\', '/')) === wanted) {
          if (entry.type !== 'File' && entry.type !== 'OldFile')
            problem = 'the binary is not a file'
          else if (++count > 1) problem = 'the binary appears twice'
          else if (entry.size > maxBinary) problem = 'the binary is too large'
          else {
            expected = entry.size
            const out = createWriteStream(dest, { mode: ctx.isWin ? 0o666 : 0o755 })
            written = finished(out)
            written.catch(() => {})
            entry.pipe(out)
            return
          }
        }
        entry.resume()
      },
    })
    if (problem === undefined && !written) problem = 'the binary is missing'
    if (problem !== undefined) throw new Rejected(problem)
    await written
    if ((await stat(dest)).size !== expected) throw new Rejected('the binary is incomplete')
    if (!ctx.isWin) await chmod(dest, 0o755)
  } catch (err) {
    // Only our own wording is shown: library and fs errors can name the data dir.
    throw new ClaudeBinaryError(
      'extract_failed',
      `The Claude binary could not be unpacked${err instanceof Rejected ? `: ${err.message}` : ''}`,
      { cause: err },
    )
  }
}
