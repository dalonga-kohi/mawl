import { randomBytes } from 'node:crypto'
import { access, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EmbeddedPgError } from './errors.ts'
import { type Clock, type LineLogger, runToExit, type SpawnFn, silentLogger } from './process.ts'

/** The Postgres major the bundle ships. A cluster from any other major is not started. */
export const PG_MAJOR = '17'
/** Layout under the data root this module owns. */
export const CLUSTER_DIR = 'cluster'
export const PASSWORD_FILE = 'password'
/** Prefix of first-run staging dirs; any left over by a crashed first run are deleted. */
export const STAGING_PREFIX = 'cluster.staging-'
export const PWFILE_PREFIX = '.initdb-pw-'

export const REQUIRED_BINARIES = ['initdb', 'postgres', 'pg_ctl'] as const

/** 32 random bytes as base64url: exactly 43 characters. */
export const passwordSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)

export function binaryPath(pgRoot: string, name: string, platform = process.platform): string {
  return join(pgRoot, 'bin', platform === 'win32' ? `${name}.exe` : name)
}

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  )

export async function requireBinaries(pgRoot: string): Promise<void> {
  const missing: string[] = []
  for (const name of REQUIRED_BINARIES) {
    if (!(await exists(binaryPath(pgRoot, name)))) missing.push(name)
  }
  if (missing.length > 0) {
    throw new EmbeddedPgError(
      'binaries_missing',
      `Postgres binaries missing from ${join(pgRoot, 'bin')}: ${missing.join(', ')}`,
    )
  }
}

export type ClusterState =
  | { state: 'absent' }
  | { state: 'valid'; password: string }
  | { state: 'corrupt'; reason: string }

/**
 * What is on disk under the data root. A cluster dir that exists but is incomplete is corrupt,
 * never absent: only a missing dir means "first run", so we never initdb over user data. The
 * first run renames a finished cluster into place, so a crash mid-initdb never leaves a dir here.
 */
export async function inspectCluster(dataRoot: string): Promise<ClusterState> {
  const dir = join(dataRoot, CLUSTER_DIR)
  const info = await stat(dir).catch(() => undefined)
  if (!info) return { state: 'absent' }
  if (!info.isDirectory()) return { state: 'corrupt', reason: `${dir} is not a directory` }

  const version = await readFile(join(dir, 'PG_VERSION'), 'utf8').catch(() => undefined)
  if (version === undefined) return { state: 'corrupt', reason: 'PG_VERSION is missing' }
  if (version.trim() !== PG_MAJOR) {
    return {
      state: 'corrupt',
      reason: `cluster is PostgreSQL ${version.trim().slice(0, 16)}, expected ${PG_MAJOR}`,
    }
  }
  for (const file of [join('global', 'pg_control'), 'postgresql.conf']) {
    if (!(await exists(join(dir, file)))) return { state: 'corrupt', reason: `${file} is missing` }
  }

  const raw = await readFile(join(dataRoot, PASSWORD_FILE), 'utf8').catch(() => undefined)
  if (raw === undefined) return { state: 'corrupt', reason: 'the password file is missing' }
  const parsed = passwordSchema.safeParse(raw.trim())
  if (!parsed.success) return { state: 'corrupt', reason: 'the password file is malformed' }
  return { state: 'valid', password: parsed.data }
}

/** The superuser initdb creates. */
export const SUPERUSER = 'mawl'

export type RenameFn = (from: string, to: string) => Promise<void>

export interface InitOptions {
  pgRoot: string
  dataRoot: string
  spawn: SpawnFn
  clock: Clock
  logger?: LineLogger
  /** Cold initdb is about 4 s with --no-sync; the cap only catches a hung tool. */
  initdbTimeoutMs?: number
  rename?: RenameFn
}

/** Windows codes for "a file in this dir is open" (Defender scanning fresh files, an indexer). */
const TRANSIENT_FS_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
const RENAME_ATTEMPTS = 8

/** Deletes staging dirs and pwfiles a crashed first run left behind. Never touches the cluster. */
export async function removeStaleArtifacts(dataRoot: string): Promise<void> {
  const names = await readdir(dataRoot).catch(() => [])
  for (const name of names) {
    if (name.startsWith(STAGING_PREFIX) || name.startsWith(PWFILE_PREFIX)) {
      await rm(join(dataRoot, name), { recursive: true, force: true })
    }
  }
}

/**
 * First run: `initdb --no-sync` into a staging dir, write the password file, then rename the
 * finished cluster into place. The rename is the commit point, so a crash at any earlier moment
 * leaves no `cluster/` and the next boot starts over. Returns the generated superuser password.
 */
export async function initCluster(opts: InitOptions): Promise<string> {
  const { pgRoot, dataRoot, spawn, clock, logger = silentLogger } = opts
  const doRename = opts.rename ?? rename
  await mkdir(dataRoot, { recursive: true })
  await removeStaleArtifacts(dataRoot)

  const id = randomBytes(6).toString('hex')
  const staging = join(dataRoot, `${STAGING_PREFIX}${id}`)
  const pwfile = join(dataRoot, `${PWFILE_PREFIX}${id}`)
  // 256 bits. Stored under the data root (never %TEMP%); mode 0o600 is best-effort on Windows,
  // where the per-user %LOCALAPPDATA% ACL is what protects it.
  const password = randomBytes(32).toString('base64url')

  const fail = async (message: string, detail?: string): Promise<never> => {
    await rm(staging, { recursive: true, force: true })
    throw new EmbeddedPgError('initdb_failed', message, detail)
  }

  await writeFile(pwfile, `${password}\n`, { mode: 0o600 })
  let result: Awaited<ReturnType<typeof runToExit>>
  try {
    result = await runToExit(
      spawn,
      binaryPath(pgRoot, 'initdb'),
      [
        `--pgdata=${staging}`,
        `--username=${SUPERUSER}`,
        `--pwfile=${pwfile}`,
        '--auth=scram-sha-256',
        '--encoding=UTF8',
        // C locale: English server messages (lc_messages) and no dependence on the Windows
        // display language, whose locale names initdb cannot always map.
        '--no-locale',
        '--no-sync',
      ],
      { clock, timeoutMs: opts.initdbTimeoutMs ?? 120_000, logger, source: 'initdb' },
    )
  } finally {
    await rm(pwfile, { force: true })
  }

  if (result.timedOut) return fail('initdb timed out', result.output)
  if (result.code !== 0) {
    return fail(
      `initdb failed (${result.error ?? `exit code ${result.code ?? result.signal}`})`,
      result.output,
    )
  }

  // The password is written before the commit point; without a cluster it is simply ignored.
  await writeFile(join(dataRoot, PASSWORD_FILE), `${password}\n`, { mode: 0o600 })
  for (let attempt = 1; ; attempt++) {
    try {
      await doRename(staging, join(dataRoot, CLUSTER_DIR))
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? ''
      if (!TRANSIENT_FS_CODES.has(code) || attempt >= RENAME_ATTEMPTS) {
        return fail(`could not move the new cluster into place (${code || String(err)})`)
      }
      // 50 ms doubling, capped at 1 s: about 3.5 s in total before giving up.
      await clock.sleep(Math.min(1_000, 50 * 2 ** (attempt - 1)))
    }
  }
  logger.info({ dataRoot }, 'embedded postgres cluster initialised')
  return password
}
