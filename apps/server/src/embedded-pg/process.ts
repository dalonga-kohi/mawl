import { spawn as nodeSpawn } from 'node:child_process'

/**
 * Spawn options we allow: stdio is always piped (or ignored), never inherited, and the child is
 * never `detached`. Inherited handles hang `pg_ctl start`, and a detached Postgres would escape the
 * kill-on-close job object that takes it down with the server (REDESIGN §10.1).
 */
export interface SpawnOpts {
  stdio: ['ignore', 'pipe', 'pipe']
  windowsHide: true
  env?: NodeJS.ProcessEnv
}

/** The slice of `ChildProcess` we use, so tests can script processes. */
export interface PgChild {
  readonly pid?: number | undefined
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  readonly stdout: NodeJS.ReadableStream | null
  readonly stderr: NodeJS.ReadableStream | null
  kill(signal?: NodeJS.Signals | number): boolean
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  once(event: 'error', listener: (err: Error) => void): this
}

export type SpawnFn = (command: string, args: readonly string[], opts: SpawnOpts) => PgChild

export const defaultSpawn: SpawnFn = (command, args, opts) => nodeSpawn(command, [...args], opts)

export interface Clock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const systemClock: Clock = {
  now: () => Date.now(),
  // unref: a timeout that lost its race must not keep the process alive.
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref()),
}

export const SPAWN_OPTS: SpawnOpts = { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }

export interface ExitInfo {
  code: number | null
  signal: NodeJS.Signals | null
  /** Set when the process could not be spawned at all. */
  error?: string
}

/** Resolves once the child is gone: on exit, or on a spawn error (which may never emit exit). */
export function waitForExit(child: PgChild): Promise<ExitInfo> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }))
    child.once('error', (err) => resolve({ code: null, signal: null, error: err.message }))
  })
}

const TIMED_OUT: unique symbol = Symbol('timed out')

/** Races a promise against a clock timeout; resolves `TIMED_OUT` when the clock wins. */
export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  clock: Clock,
): Promise<T | typeof TIMED_OUT> {
  return Promise.race([promise, clock.sleep(ms).then((): typeof TIMED_OUT => TIMED_OUT)])
}
export const isTimedOut = (v: unknown): v is typeof TIMED_OUT => v === TIMED_OUT

export interface LineLogger {
  debug(obj: object, msg: string): void
  info(obj: object, msg: string): void
  warn(obj: object, msg: string): void
  error(obj: object, msg: string): void
}

export const silentLogger: LineLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
}

/**
 * Drains a child's stdout and stderr (an undrained pipe blocks the child once its buffer fills),
 * keeps the last `maxChars` for diagnostics and forwards each line to the logger at debug.
 * Output is only ever diagnostics: Postgres messages are localized, so no logic parses them.
 */
export class OutputTail {
  #text = ''
  #partial = ''

  constructor(
    private readonly logger: LineLogger,
    private readonly source: string,
    private readonly maxChars = 16_384,
  ) {}

  attach(child: PgChild): this {
    for (const stream of [child.stdout, child.stderr]) {
      stream?.on('data', (chunk: Buffer | string) => this.push(chunk.toString()))
    }
    return this
  }

  push(text: string): void {
    this.#text = (this.#text + text).slice(-this.maxChars)
    const lines = (this.#partial + text).split(/\r?\n/)
    this.#partial = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() !== '') this.logger.debug({ source: this.source }, line)
    }
  }

  text(): string {
    return this.#text
  }
}

export interface RunResult extends ExitInfo {
  timedOut: boolean
  output: string
}

/**
 * Runs a short-lived tool (initdb, pg_ctl) to completion. Only its exit code means anything;
 * a hung tool is killed at the timeout.
 */
export async function runToExit(
  spawn: SpawnFn,
  command: string,
  args: readonly string[],
  {
    clock,
    timeoutMs,
    logger,
    source,
  }: { clock: Clock; timeoutMs: number; logger: LineLogger; source: string },
): Promise<RunResult> {
  let child: PgChild
  try {
    child = spawn(command, args, SPAWN_OPTS)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    return { code: null, signal: null, error, timedOut: false, output: '' }
  }
  const tail = new OutputTail(logger, source).attach(child)
  const exited = waitForExit(child)
  const result = await withTimeout(exited, timeoutMs, clock)
  if (isTimedOut(result)) {
    child.kill()
    const after = await withTimeout(exited, 5_000, clock)
    const info = isTimedOut(after) ? { code: null, signal: null } : after
    return { ...info, timedOut: true, output: tail.text() }
  }
  return { ...result, timedOut: false, output: tail.text() }
}
