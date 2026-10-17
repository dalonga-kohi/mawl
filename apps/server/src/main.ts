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

// Boot runs in the background so signals are handled from the start. A signal during boot
// waits for boot to settle (never stop mid-migration), then stops; a failed boot exits 1.
const booting = startServer(config, { logger })
installLifecycle({
  logger,
  stop: async () => (await booting).stop(),
  exit: (code) => process.exit(code),
  proc: process,
})

booting.catch((err: unknown) => {
  // Name, code, and message only for our own error classes (see describeFailure).
  logger.fatal(describeFailure(err), 'boot failed')
  process.exit(1)
})
