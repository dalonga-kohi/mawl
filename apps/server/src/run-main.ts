import type { Readable } from 'node:stream'
import type { DestinationStream } from 'pino'
import { type Config, ConfigError, parseConfig } from './config.ts'
import { describeFailure } from './failure.ts'
import { readLaunchToken } from './launch-token.ts'
import { installLifecycle, type LifecycleDeps, stopAfterBoot } from './lifecycle.ts'
import { createLogger } from './logger.ts'
import { registerSecretValue } from './redact.ts'
import { readHostMasterKey } from './secrets/index.ts'
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
  /** How long the master key line may take after the token line. */
  keyTimeoutMs?: number
}

/**
 * The process entrypoint, with its process pieces injected. Order: config, logger, then in
 * desktop mode the launch token from stdin's first line and the master key from its second, then
 * boot. Signals are handled from the start; in desktop mode stdin closing after the token (the
 * host died or let go) stops the server the same way. Exits 1 on a bad config, a missing or
 * invalid token or key, or a failed boot.
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
  // Filled by startServer (the embedded Postgres), run by the lifecycle before a hard exit 1.
  const emergencyStops = new Set<() => Promise<unknown>>()
  const registerEmergencyStop = (stop: () => Promise<unknown>) => {
    emergencyStops.add(stop)
  }

  // Boot runs in the background so signals are handled from the start. A signal during boot
  // waits for boot to settle (never stop mid-migration), then stops; a failed boot exits 1.
  const booting = (async () => {
    if (config.mode !== 'desktop') {
      return start(config, {
        logger,
        registerEmergencyStop,
        // The one unredacted output: a newly generated owner token, shown once on stderr.
        announceOwnerToken: (text) => void deps.stderr.write(text),
      })
    }
    const launch = await readLaunchToken(deps.stdin(), {
      ...(deps.tokenTimeoutMs === undefined ? {} : { timeoutMs: deps.tokenTimeoutMs }),
      onParentGone: () => shutdown?.('stdin_eof'),
    })
    const launchToken = launch.token
    // Before anything can log it. Kept in memory only; D1.4 checks requests against it.
    registerSecretValue(launchToken)
    // The second line: the master key from Windows Credential Manager (D1.6). Its text form is
    // registered before anything can log it; the bytes go to startServer only, never to a log call.
    const hostMasterKey = await readHostMasterKey(launch, {
      ...(deps.keyTimeoutMs === undefined ? {} : { timeoutMs: deps.keyTimeoutMs }),
    })
    registerSecretValue(hostMasterKey.encoded())
    return start({ ...config, launchToken }, { logger, registerEmergencyStop, hostMasterKey })
  })()

  ;({ shutdown } = installLifecycle({
    logger,
    stop: stopAfterBoot(booting),
    booted: booting,
    exit: deps.exit,
    proc: deps.proc,
    emergencyStop: () => Promise.allSettled([...emergencyStops].map((stop) => stop())),
  }))

  booting.catch((err: unknown) => {
    // Name, code, and message only for our own error classes (see describeFailure).
    logger.fatal(describeFailure(err), 'boot failed')
    deps.exit(1)
  })
}
