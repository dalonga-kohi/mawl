import type { Readable } from 'node:stream'
import type { DestinationStream } from 'pino'
import { type Config, ConfigError, parseConfig } from './config.ts'
import { describeFailure } from './failure.ts'
import { readLaunchToken } from './launch-token.ts'
import { installLifecycle, type LifecycleDeps, stopAfterBoot } from './lifecycle.ts'
import { createLogger } from './logger.ts'
import { registerSecretValue } from './redact.ts'
import { startServer } from './server.ts'

export interface MainDeps {
  env: Record<string, string | undefined>
  /** Only called in desktop mode: headless never opens stdin. */
  stdin: () => Readable
  proc: LifecycleDeps['proc']
  exit: (code: number) => void
  stderr: { write(text: string): unknown }
  /** Defaults to stdout. */
  logStream?: DestinationStream
  startServer?: typeof startServer
  tokenTimeoutMs?: number
}

/**
 * The process entrypoint, with its process pieces injected. Order: config, logger, then in
 * desktop mode the launch token from stdin's first line, then boot. Signals are handled from the
 * start; in desktop mode stdin closing after the token (the host died or let go) stops the server
 * the same way. Exits 1 on a bad config, a missing or invalid token, or a failed boot.
 */
export function runMain(deps: MainDeps): void {
  let config: Config
  try {
    config = parseConfig(deps.env)
  } catch (err) {
    // No logger yet (its level comes from the config). ConfigError carries names only.
    const message = err instanceof ConfigError ? err.message : 'Invalid configuration'
    deps.stderr.write(`${message}\n`)
    deps.exit(1)
    return
  }

  const logger = createLogger({
    level: config.logLevel,
    ...(deps.logStream ? { stream: deps.logStream } : {}),
  })
  const start = deps.startServer ?? startServer
  let shutdown: ((reason: string) => void) | undefined

  // Boot runs in the background so signals are handled from the start. A signal during boot
  // waits for boot to settle (never stop mid-migration), then stops; a failed boot exits 1.
  const booting = (async () => {
    if (config.mode !== 'desktop') return start(config, { logger })
    const { token: launchToken } = await readLaunchToken(deps.stdin(), {
      ...(deps.tokenTimeoutMs === undefined ? {} : { timeoutMs: deps.tokenTimeoutMs }),
      onParentGone: () => shutdown?.('stdin_eof'),
    })
    // Before anything can log it. Kept in memory only; D1.4 checks requests against it.
    registerSecretValue(launchToken)
    return start({ ...config, launchToken }, { logger })
  })()

  ;({ shutdown } = installLifecycle({
    logger,
    stop: stopAfterBoot(booting),
    booted: booting,
    exit: deps.exit,
    proc: deps.proc,
  }))

  booting.catch((err: unknown) => {
    // Name, code, and message only for our own error classes (see describeFailure).
    logger.fatal(describeFailure(err), 'boot failed')
    deps.exit(1)
  })
}
