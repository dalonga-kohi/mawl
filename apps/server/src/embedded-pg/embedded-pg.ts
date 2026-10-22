import { createServer } from 'node:net'
import { join } from 'node:path'
import pg from 'pg'
import { z } from 'zod'
import {
  binaryPath,
  CLUSTER_DIR,
  initCluster,
  inspectCluster,
  type RenameFn,
  removeStaleArtifacts,
  requireBinaries,
  SUPERUSER,
} from './cluster.ts'
import { EmbeddedPgError } from './errors.ts'
import {
  type Clock,
  defaultSpawn,
  type ExitInfo,
  isTimedOut,
  type LineLogger,
  OutputTail,
  type PgChild,
  runToExit,
  SPAWN_OPTS,
  type SpawnFn,
  silentLogger,
  systemClock,
  waitForExit,
  withTimeout,
} from './process.ts'

export const LOOPBACK = '127.0.0.1'

export interface PgConnection {
  host: string
  port: number
  user: string
  password: string
  database: string
}

/** One readiness check. `auth_failed` means the stored password does not match the cluster. */
export type ProbeResult = 'ready' | 'not_ready' | 'auth_failed'

export interface EmbeddedPgDeps {
  spawn: SpawnFn
  clock: Clock
  /** A port that was free on 127.0.0.1 a moment ago (Postgres may still lose a race for it). */
  findFreePort(): Promise<number>
  /** Whether nothing else holds the port; used to tell a lost port race from other failures. */
  isPortFree(port: number): Promise<boolean>
  probe(conn: PgConnection): Promise<ProbeResult>
  /** Creates the app database when it is missing. Runs on every start (a crash may have hit
   * between the first start and the CREATE DATABASE). */
  ensureDatabase(conn: PgConnection): Promise<void>
  rename?: RenameFn
}

const optionsSchema = z.object({
  pgRoot: z.string().min(1),
  dataRoot: z.string().min(1),
  database: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .default('mawl'),
  startTimeoutMs: z.number().int().positive().default(60_000),
  stopTimeoutMs: z.number().int().positive().default(15_000),
  initdbTimeoutMs: z.number().int().positive().default(120_000),
  maxPortAttempts: z.number().int().min(1).max(20).default(3),
  pollIntervalMs: z.number().int().positive().default(100),
  authGraceMs: z.number().int().positive().default(1_500),
})

export interface StartOptions {
  /** Dir holding `bin/initdb(.exe)`, `bin/postgres(.exe)`, `bin/pg_ctl(.exe)` (the install's `pg\`). */
  pgRoot: string
  /** Dir this module owns: `cluster/`, `password`, and first-run staging. Never the install dir. */
  dataRoot: string
  /** App database, created on demand. Default `mawl`. */
  database?: string
  logger?: LineLogger
  /** Until Postgres accepts connections; crash recovery after a hard kill counts. Default 60 s. */
  startTimeoutMs?: number
  /** For `pg_ctl stop -w`, then postgres is killed. Default 15 s. */
  stopTimeoutMs?: number
  initdbTimeoutMs?: number
  maxPortAttempts?: number
  pollIntervalMs?: number
  /** How long a postgres whose password was rejected gets to show it lost a port race. */
  authGraceMs?: number
  deps?: Partial<EmbeddedPgDeps>
  /**
   * Called right after each postgres spawn, before the readiness wait (initdb or WAL recovery can
   * take up to `startTimeoutMs`), with a stop for that postgres: the caller registers it as its
   * emergency stop, so a hard exit during the wait never orphans Postgres. Idempotent; never
   * rejects. Called again for a postgres started on a new port after a lost port race.
   */
  onSpawn?: (stop: () => Promise<{ clean: boolean }>) => void
  /**
   * A shutdown during the start: aborting stops a postgres that is still starting (`pg_ctl stop`,
   * a kill only as the fallback) and rejects with `EmbeddedPgError('aborted')`. An abort after
   * the start resolved changes nothing; stop the handle instead.
   */
  signal?: AbortSignal
}

export interface PgExit extends ExitInfo {
  /** True when `stop()` caused it; false means Postgres died on its own or was killed. */
  expected: boolean
}

export interface EmbeddedPostgres {
  readonly port: number
  readonly pid: number | undefined
  /** True when this start ran initdb. */
  readonly cold: boolean
  /** Contains the password: never log it (the logger redacts the key, not the value). */
  readonly connectionString: string
  readonly connection: PgConnection
  /** Resolves when Postgres exits, for whatever reason. Never rejects. */
  readonly exited: Promise<PgExit>
  /** The latest Postgres output, for diagnostics. */
  output(): string
  /** `pg_ctl stop -m fast -w`, falling back to a kill. Idempotent; never rejects. */
  stop(): Promise<{ clean: boolean }>
}

export async function startEmbeddedPostgres(options: StartOptions): Promise<EmbeddedPostgres> {
  const opts = optionsSchema.parse(options)
  const logger = options.logger ?? silentLogger
  const deps: EmbeddedPgDeps = { ...defaultDeps(), ...options.deps }
  const { spawn, clock } = deps
  const { signal } = options
  const clusterDir = join(opts.dataRoot, CLUSTER_DIR)
  const throwIfAborted = () => {
    if (signal?.aborted) {
      throw new EmbeddedPgError('aborted', 'The Postgres start was aborted by a shutdown')
    }
  }

  throwIfAborted()
  await requireBinaries(opts.pgRoot)
  const state = await inspectCluster(opts.dataRoot)
  // A first run cleans up inside initCluster; a warm boot cleans up here. Two server instances
  // on one data root are unsupported: single instance is the desktop host's job (D1.5).
  if (state.state === 'valid') await removeStaleArtifacts(opts.dataRoot)
  if (state.state === 'corrupt') {
    throw new EmbeddedPgError(
      'data_dir_corrupt',
      `The Postgres data dir is unusable: ${state.reason}`,
    )
  }
  const cold = state.state === 'absent'
  const password =
    state.state === 'valid'
      ? state.password
      : await initCluster({
          pgRoot: opts.pgRoot,
          dataRoot: opts.dataRoot,
          spawn,
          clock,
          logger,
          initdbTimeoutMs: opts.initdbTimeoutMs,
          ...(deps.rename ? { rename: deps.rename } : {}),
        })

  const stopChild = (child: PgChild, exited: Promise<ExitInfo>) =>
    stopPostgres({
      child,
      exited,
      clusterDir,
      pgRoot: opts.pgRoot,
      spawn,
      clock,
      logger,
      timeoutMs: opts.stopTimeoutMs,
    })

  for (let attempt = 1; ; attempt++) {
    // Also after a long initdb: a shutdown that came meanwhile starts no postgres.
    throwIfAborted()
    const port = await deps.findFreePort()
    let child: PgChild
    try {
      child = spawn(
        binaryPath(opts.pgRoot, 'postgres'),
        [
          '-D',
          clusterDir,
          '-p',
          String(port),
          '-c',
          `listen_addresses=${LOOPBACK}`,
          // Output comes to us over the pipe; the collector would detach it into files.
          '-c',
          'logging_collector=off',
        ],
        SPAWN_OPTS,
      )
    } catch (err) {
      throw new EmbeddedPgError('start_failed', `Could not spawn postgres: ${errorText(err)}`)
    }
    const exited = waitForExit(child)
    // One stop per postgres, shared by onSpawn's emergency stop, the failure paths and the handle.
    let stopping: Promise<{ clean: boolean }> | undefined
    const stopThis = () => {
      stopping ??= stopChild(child, exited)
      return stopping
    }
    const tail = new OutputTail(logger, 'postgres')
    const probeConn: PgConnection = {
      host: LOOPBACK,
      port,
      user: SUPERUSER,
      password,
      database: 'postgres',
    }

    // From here on a postmaster is running: any unexpected throw must stop it before
    // surfacing, or it would outlive the failed boot.
    let outcome: ReadyOutcome
    try {
      tail.attach(child)
      options.onSpawn?.(stopThis)
      outcome = await waitUntilReady({ deps, exited, conn: probeConn, opts, signal })
    } catch (err) {
      await stopThis()
      throw new EmbeddedPgError(
        'start_failed',
        `Postgres startup check failed: ${errorText(err)}`,
        tail.text(),
      )
    }
    const abortStart = async (): Promise<never> => {
      await stopThis()
      throw new EmbeddedPgError(
        'aborted',
        'The Postgres start was aborted by a shutdown',
        tail.text(),
      )
    }
    if (outcome.kind === 'aborted') return abortStart()
    if (outcome.kind === 'ready') {
      const conn: PgConnection = { ...probeConn, database: opts.database }
      try {
        await deps.ensureDatabase(conn)
      } catch (err) {
        await stopThis()
        throw new EmbeddedPgError(
          'start_failed',
          `Could not create the ${opts.database} database: ${errorText(err)}`,
          tail.text(),
        )
      }
      if (signal?.aborted) return abortStart()
      logger.info({ port, cold, pid: child.pid }, 'embedded postgres ready')
      return makeHandle({
        child,
        exited,
        conn,
        cold,
        tail,
        stop: stopThis,
        stopRequested: () => stopping !== undefined,
      })
    }
    if (outcome.kind === 'timeout') {
      await stopThis()
      throw new EmbeddedPgError(
        'start_timeout',
        `Postgres did not accept connections within ${opts.startTimeoutMs} ms`,
        tail.text(),
      )
    }
    if (outcome.kind === 'auth_failed') {
      await stopThis()
      throw new EmbeddedPgError(
        'data_dir_corrupt',
        'The Postgres data dir is unusable: the stored password was rejected',
        tail.text(),
      )
    }
    // Postgres exited during startup. If someone else now holds our port, we lost the race
    // between picking it and Postgres binding it: try another one.
    const portTaken = !(await deps.isPortFree(port))
    if (portTaken) {
      if (attempt < opts.maxPortAttempts) {
        logger.warn({ port, attempt }, 'embedded postgres lost its port, retrying on another')
        continue
      }
      throw new EmbeddedPgError(
        'port_unavailable',
        `No free loopback port after ${attempt} attempts`,
        tail.text(),
      )
    }
    const info = outcome.exit
    throw new EmbeddedPgError(
      'start_failed',
      `Postgres exited during startup (${info.error ?? `exit code ${info.code ?? info.signal}`})`,
      tail.text(),
    )
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

type ReadyOutcome =
  | { kind: 'ready' }
  | { kind: 'auth_failed' }
  | { kind: 'timeout' }
  | { kind: 'exited'; exit: ExitInfo }
  | { kind: 'aborted' }

const ABORTED = Symbol('aborted')

async function waitUntilReady({
  deps,
  exited,
  conn,
  opts,
  signal,
}: {
  deps: EmbeddedPgDeps
  exited: Promise<ExitInfo>
  conn: PgConnection
  opts: { startTimeoutMs: number; pollIntervalMs: number; authGraceMs: number }
  signal: AbortSignal | undefined
}): Promise<ReadyOutcome> {
  let exit: ExitInfo | undefined
  void exited.then((info) => {
    exit = info
  })
  // Settles when the signal fires, so a long probe or poll sleep never delays the abort.
  let onAbort: (() => void) | undefined
  const aborted = new Promise<typeof ABORTED>((resolve) => {
    if (!signal) return
    if (signal.aborted) {
      resolve(ABORTED)
      return
    }
    onAbort = () => resolve(ABORTED)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await pollUntilReady({ deps, exited, conn, opts, aborted, exitSoFar: () => exit })
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
}

async function pollUntilReady({
  deps,
  exited,
  conn,
  opts,
  aborted,
  exitSoFar,
}: {
  deps: EmbeddedPgDeps
  exited: Promise<ExitInfo>
  conn: PgConnection
  opts: { startTimeoutMs: number; pollIntervalMs: number; authGraceMs: number }
  aborted: Promise<typeof ABORTED>
  exitSoFar: () => ExitInfo | undefined
}): Promise<ReadyOutcome> {
  const deadline = deps.clock.now() + opts.startTimeoutMs
  for (;;) {
    let exit = exitSoFar()
    if (exit) return { kind: 'exited', exit }
    const result = await Promise.race([deps.probe(conn), aborted])
    if (result === ABORTED) return { kind: 'aborted' }
    exit = exitSoFar()
    if (exit) return { kind: 'exited', exit }
    // 'ready' can arrive while our postgres is already dying (its exit not yet observed), in
    // theory from a foreign server that holds our port. Accepting it is safe: a foreign server
    // only answers 'ready' if it knows our random 256-bit password, and a postgres that dies
    // after this point surfaces through `exited` (expected: false) like any later crash.
    if (result === 'ready') return { kind: 'ready' }
    if (result === 'auth_failed') {
      // If our postgres lost the port race, the probe may have reached whoever holds the port
      // (another Postgres rejects our password). Ours then exits within moments: give it the
      // chance before blaming the data dir.
      const late = await withTimeout(exited, opts.authGraceMs, deps.clock)
      return isTimedOut(late) ? { kind: 'auth_failed' } : { kind: 'exited', exit: late }
    }
    if (deps.clock.now() >= deadline) return { kind: 'timeout' }
    if ((await Promise.race([deps.clock.sleep(opts.pollIntervalMs), aborted])) === ABORTED) {
      return { kind: 'aborted' }
    }
  }
}

/**
 * `pg_ctl stop -m fast -w`: a clean shutdown with a checkpoint, so the next start runs no crash
 * recovery. Only the exit code is read (pg_ctl output is localized). When pg_ctl fails, hangs, or
 * Postgres outlives it, Postgres is killed: the data stays recoverable through the WAL.
 */
async function stopPostgres({
  child,
  exited,
  clusterDir,
  pgRoot,
  spawn,
  clock,
  logger,
  timeoutMs,
}: {
  child: PgChild
  exited: Promise<ExitInfo>
  clusterDir: string
  pgRoot: string
  spawn: SpawnFn
  clock: Clock
  logger: LineLogger
  timeoutMs: number
}): Promise<{ clean: boolean }> {
  if (child.exitCode !== null || child.signalCode !== null) return { clean: false }
  const result = await runToExit(
    spawn,
    binaryPath(pgRoot, 'pg_ctl'),
    ['stop', '-D', clusterDir, '-m', 'fast', '-w', '-t', String(Math.ceil(timeoutMs / 1000))],
    // pg_ctl enforces -t itself; our cap only catches a pg_ctl that hangs anyway.
    { clock, timeoutMs: timeoutMs + 5_000, logger, source: 'pg_ctl' },
  )
  if (result.code === 0 && !result.timedOut) {
    const after = await withTimeout(exited, 5_000, clock)
    if (!isTimedOut(after)) return { clean: true }
    logger.warn({ pid: child.pid }, 'postgres outlived pg_ctl stop, killing it')
  } else {
    logger.warn(
      { code: result.code, timedOut: result.timedOut, pid: child.pid },
      'pg_ctl stop failed, killing postgres',
    )
  }
  child.kill()
  const killed = await withTimeout(exited, 5_000, clock)
  if (isTimedOut(killed)) logger.error({ pid: child.pid }, 'postgres did not exit after a kill')
  return { clean: false }
}

function makeHandle({
  child,
  exited,
  conn,
  cold,
  tail,
  stop,
  stopRequested,
}: {
  child: PgChild
  exited: Promise<ExitInfo>
  conn: PgConnection
  cold: boolean
  tail: OutputTail
  /** Idempotent: the same stop `onSpawn` handed out. */
  stop: () => Promise<{ clean: boolean }>
  /** Whether that stop was called (by the handle or as an emergency stop). */
  stopRequested: () => boolean
}): EmbeddedPostgres {
  return {
    port: conn.port,
    pid: child.pid,
    cold,
    connection: conn,
    connectionString: `postgres://${conn.user}:${encodeURIComponent(conn.password)}@${conn.host}:${conn.port}/${conn.database}`,
    exited: exited.then((info) => ({ ...info, expected: stopRequested() })),
    output: () => tail.text(),
    stop,
  }
}

// ---- Default (real) dependencies ----

function listenOnce(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen({ port, host: LOOPBACK, exclusive: true }, () => {
      const address = server.address()
      const bound = typeof address === 'object' && address ? address.port : port
      server.close(() => resolve(bound))
    })
  })
}

const AUTH_ERROR_CODES = new Set(['28P01', '28000'])

async function probeConnection(conn: PgConnection): Promise<ProbeResult> {
  const client = new pg.Client({ ...conn, connectionTimeoutMillis: 2_000 })
  // An 'error' event without a listener would crash the process.
  client.on('error', () => {})
  try {
    await client.connect()
    await client.query('select 1')
    return 'ready'
  } catch (err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' && AUTH_ERROR_CODES.has(code) ? 'auth_failed' : 'not_ready'
  } finally {
    await client.end().catch(() => {})
  }
}

async function ensureDatabaseExists(conn: PgConnection): Promise<void> {
  const client = new pg.Client({ ...conn, database: 'postgres', connectionTimeoutMillis: 5_000 })
  client.on('error', () => {})
  try {
    await client.connect()
    const found = await client.query('select 1 from pg_database where datname = $1', [
      conn.database,
    ])
    if (found.rowCount === 0) {
      // The name is validated against /^[a-z_][a-z0-9_]*$/, so quoting it is enough.
      await client.query(`create database "${conn.database}"`).catch((err: { code?: string }) => {
        if (err.code !== '42P04') throw err // duplicate_database: someone else created it
      })
    }
  } finally {
    await client.end().catch(() => {})
  }
}

export function defaultDeps(): EmbeddedPgDeps {
  return {
    spawn: defaultSpawn,
    clock: systemClock,
    findFreePort: () => listenOnce(0),
    isPortFree: (port) =>
      listenOnce(port).then(
        () => true,
        () => false,
      ),
    probe: probeConnection,
    ensureDatabase: ensureDatabaseExists,
  }
}
