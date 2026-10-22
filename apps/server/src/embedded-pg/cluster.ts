import { access, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { EmbeddedPgError } from './errors.ts'

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
