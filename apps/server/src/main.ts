import { ConfigError, parseConfig } from './config.ts'
import { describeFailure } from './failure.ts'
import { installLifecycle } from './lifecycle.ts'
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

// Installed before boot so an early crash still exits 1 with a redacted log line.
let stop: () => Promise<void> = async () => {}
installLifecycle({ logger, stop: () => stop(), exit: (code) => process.exit(code), proc: process })

try {
  const server = await startServer(config, { logger })
  stop = server.stop
} catch (err) {
  // Name, code, and message only for our own error classes (see describeFailure).
  logger.fatal(describeFailure(err), 'boot failed')
  process.exit(1)
}
