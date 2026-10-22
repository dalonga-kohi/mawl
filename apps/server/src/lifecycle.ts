import { describeFailure } from './failure.ts'
import type { Logger } from './logger.ts'

export interface LifecycleDeps {
  logger: Logger
  /** Stops the server (listener, database). */
  stop: () => Promise<void>
  exit: (code: number) => void
  proc: { on(event: string, listener: (...args: unknown[]) => void): unknown }
  /**
   * Settles when boot has finished (either way). The shutdown deadline only starts then, so a
   * slow migration is never cut off. Omit when the server is already running.
   */
  booted?: Promise<unknown>
  /** Hard shutdown deadline, counted from when boot settles. Defaults to 10 s. */
  deadlineMs?: number
}

const DEFAULT_DEADLINE_MS = 10_000

/**
 * Wires process signals and fatal-error events.
 * - First SIGINT/SIGTERM: graceful stop, exit 0; a 10 s deadline forces exit 1.
 * - A second signal exits 1 immediately.
 * - unhandledRejection / uncaughtException: log name and code only, exit 1.
 *
 * Returns `shutdown(reason)`, which starts the same graceful stop from code (the desktop parent
 * watchdog on stdin EOF). It counts as the first signal.
 */
export function installLifecycle({
  logger,
  stop,
  exit,
  proc,
  booted = Promise.resolve(),
  deadlineMs = DEFAULT_DEADLINE_MS,
}: LifecycleDeps): { shutdown(reason: string): void } {
  let shuttingDown = false

  // signal is a signal name, or a reason such as stdin_eof from shutdown().
  const onSignal = (signal: string) => {
    if (shuttingDown) {
      logger.warn({ signal }, 'second signal, exiting now')
      exit(1)
      return
    }
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    let deadline: ReturnType<typeof setTimeout> | undefined
    let done = false
    booted.then(
      () => startDeadline(),
      () => startDeadline(),
    )
    function startDeadline() {
      if (done) return
      deadline = setTimeout(() => {
        logger.error('shutdown deadline exceeded')
        exit(1)
      }, deadlineMs)
      deadline.unref()
    }
    stop().then(
      () => {
        done = true
        clearTimeout(deadline)
        exit(0)
      },
      (err: unknown) => {
        done = true
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
  return { shutdown: onSignal }
}

/**
 * A stop function for a server that is still booting: waits for boot to settle (never stops
 * mid-migration), then stops it. If boot fails, this rejects, so shutdown exits 1.
 */
export function stopAfterBoot(booting: Promise<{ stop(): Promise<void> }>): () => Promise<void> {
  return async () => (await booting).stop()
}
