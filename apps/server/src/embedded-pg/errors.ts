/**
 * Why the embedded Postgres could not boot. The codes are a closed set so the desktop host can map
 * each one to its own copy and action (D1.3/D1.5); `detail` is diagnostics, never shown raw.
 *
 * - `binaries_missing`: `initdb`, `postgres` or `pg_ctl` is not in `<pgRoot>/bin` (broken install).
 * - `initdb_failed`: the first-run `initdb` exited non-zero or timed out. Nothing was left behind.
 * - `data_dir_corrupt`: the cluster dir exists but is incomplete, from another major version, or
 *   its password file is missing or rejected. Never repaired automatically: it holds user data.
 * - `port_unavailable`: every port we picked was taken before Postgres could bind it.
 * - `start_timeout`: Postgres did not accept connections in time (it was stopped again).
 * - `start_failed`: Postgres exited during startup for another reason (see `detail`).
 * - `aborted`: the caller's `signal` fired before Postgres was ready (a shutdown during boot); a
 *   postgres that had been spawned was stopped first.
 */
export const EMBEDDED_PG_ERROR_CODES = [
  'binaries_missing',
  'initdb_failed',
  'data_dir_corrupt',
  'port_unavailable',
  'start_timeout',
  'start_failed',
  'aborted',
] as const

export type EmbeddedPgErrorCode = (typeof EMBEDDED_PG_ERROR_CODES)[number]

export class EmbeddedPgError extends Error {
  override readonly name = 'EmbeddedPgError'
  readonly code: EmbeddedPgErrorCode
  /** Tail of the Postgres/initdb output, for "copy diagnostics". Never contains the password. */
  readonly detail: string | undefined

  constructor(code: EmbeddedPgErrorCode, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

export const isEmbeddedPgError = (err: unknown): err is EmbeddedPgError =>
  err instanceof EmbeddedPgError
