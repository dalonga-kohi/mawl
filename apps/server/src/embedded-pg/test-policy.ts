import { existsSync } from 'node:fs'
import { binaryPath, REQUIRED_BINARIES } from './cluster.ts'

export interface EmbeddedPgPolicy {
  action: 'run' | 'skip' | 'fail'
  reason: string
  pgRoot: string
}

const isSet = (v: string | undefined) => v !== undefined && v !== '' && v !== '0' && v !== 'false'

export const hasPgBinaries = (pgRoot: string) =>
  REQUIRED_BINARIES.every((n) => existsSync(binaryPath(pgRoot, n)))

/**
 * Whether the real-binary embedded Postgres suite runs. It needs Windows and the bundle at
 * MAWL_PG_ROOT (`infra/desktop/fetch-pg.ps1`). It skips otherwise, but fails when
 * MAWL_REQUIRE_EMBEDDED_PG is set, so the Windows CI job can never go green by skipping. Plain
 * `CI` does not require it: the Linux jobs cannot run it.
 */
export function embeddedPgPolicy({
  platform = process.platform,
  env = process.env,
  hasBinaries = hasPgBinaries,
}: {
  platform?: string
  env?: Record<string, string | undefined>
  hasBinaries?: (pgRoot: string) => boolean
} = {}): EmbeddedPgPolicy {
  const pgRoot = env.MAWL_PG_ROOT ?? ''
  const missing =
    platform !== 'win32'
      ? `the embedded Postgres suite is Windows-only (this is ${platform})`
      : pgRoot === ''
        ? 'MAWL_PG_ROOT is not set (run infra/desktop/fetch-pg.ps1)'
        : !hasBinaries(pgRoot)
          ? `MAWL_PG_ROOT (${pgRoot}) has no initdb/postgres/pg_ctl in bin`
          : undefined
  if (missing === undefined) return { action: 'run', reason: '', pgRoot }
  return isSet(env.MAWL_REQUIRE_EMBEDDED_PG)
    ? { action: 'fail', reason: `MAWL_REQUIRE_EMBEDDED_PG is set but ${missing}`, pgRoot }
    : { action: 'skip', reason: missing, pgRoot }
}
