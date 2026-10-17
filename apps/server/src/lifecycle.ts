import { describeFailure } from './failure.ts'
import type { Logger } from './logger.ts'

export interface LifecycleDeps {
  logger: Logger
  /** Stops the server (listener, database). */
  stop: () => Promise<void>
  exit: (code: number) => void
  proc: { on(event: string, listener: (...args: unknown[]) => void): unknown }
  /** Hard shutdown deadline. Defaults to 10 s. */
  deadlineMs?: number
}

const DEFAULT_DEADLINE_MS = 10_000

/**
 * Wires process signals and fatal-error events.
 * - First SIGINT/SIGTERM: graceful stop, exit 0; a 10 s deadline forces exit 1.
 * - A second signal exits 1 immediately.
 * - unhandledRejection / uncaughtException: log name and code only, exit 1.
 */
export function installLifecycle({
  logger,
  stop,
  exit,
  proc,
  deadlineMs = DEFAULT_DEADLINE_MS,
}: LifecycleDeps): void {
  let shuttingDown = false

  const onSignal = (signal: string) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second signal, exiting now')
      exit(1)
      return
    }
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    const deadline = setTimeout(() => {
      logger.error('shutdown deadline exceeded')
      exit(1)
    }, deadlineMs)
    deadline.unref()
    stop().then(
      () => {
        clearTimeout(deadline)
        exit(0)
      },
      (err: unknown) => {
        clearTimeout(deadline)
        logger.error(describeFailure(err), 'shutdown failed')
        exit(1)
      },
    )
  }

  let fataling = false
  const onFatal = (kind: string) => (err: unknown) => {
    if (fataling) return
    fataling = true
    logger.fatal({ ...describeFailure(err), kind }, 'fatal error')
    exit(1)
  }

  proc.on('SIGINT', () => onSignal('SIGINT'))
  proc.on('SIGTERM', () => onSignal('SIGTERM'))
  proc.on('unhandledRejection', onFatal('unhandledRejection'))
  proc.on('uncaughtException', onFatal('uncaughtException'))
}
