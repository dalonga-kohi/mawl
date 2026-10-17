import { ConfigError, parseConfig } from './config.ts'
import { createLogger } from './logger.ts'
import { startServer } from './server.ts'

let config: ReturnType<typeof parseConfig>
try {
  config = parseConfig()
} catch (err) {
  // No logger yet (its level comes from the config). ConfigError carries names only.
  const message = err instanceof ConfigError ? err.message : 'Invalid configuration'
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

const logger = createLogger({ level: config.logLevel })

try {
  const server = await startServer(config, { logger })

  let shuttingDown = false
  const shutdown = (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    logger.info({ signal }, 'shutting down')
    server.stop().then(
      () => process.exit(0),
      (err: unknown) => {
        logger.error({ errName: errorName(err) }, 'shutdown failed')
        process.exit(1)
      },
    )
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
} catch (err) {
  // Only name, code and message: error objects can carry the connection string in extra fields.
  const e = err as { message?: unknown; code?: unknown }
  logger.fatal(
    {
      errName: errorName(err),
      code: typeof e.code === 'string' ? e.code : undefined,
      reason: typeof e.message === 'string' ? e.message : undefined,
    },
    'boot failed',
  )
  process.exit(1)
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : 'UnknownError'
}
