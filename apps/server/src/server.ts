import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDb, migrate, migrationsFolder } from '@faire/db'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import type { Config } from './config.ts'
import { probeDb } from './db-probe.ts'
import { createLogger, type Logger } from './logger.ts'
import { createProviderService } from './providers/service.ts'
import {
  createSecretBox,
  loadOrCreateHostId,
  loadOrCreateMasterKey,
  type SecretBox,
} from './secrets/index.ts'
import { readVersion } from './version.ts'

/** Replaceable pieces, so tests can boot without a database. */
export interface BootOverrides {
  logger?: Logger
  createDb?: typeof createDb
  migrate?: typeof migrate
}

export interface RunningServer {
  /** Base url the server listens on, e.g. http://127.0.0.1:7420 */
  url: string
  secretBox: SecretBox
  /** Stops accepting requests, closes connections and the database. Safe to call twice. */
  stop(): Promise<void>
}

const CONNECTION_GRACE_MS = 5000
/** Server-side cap for the health query, below the 2 s probe deadline. */
const HEALTH_QUERY_TIMEOUT_MS = 1500

/** In the production bundle the SQL is copied next to the bundle (dist/drizzle). */
function resolveMigrationsFolder(): string {
  const beside = fileURLToPath(new URL('./drizzle', import.meta.url))
  return existsSync(join(beside, 'meta', '_journal.json')) ? beside : migrationsFolder
}

function listen(
  app: ReturnType<typeof createApp>,
  config: Config,
): Promise<{ server: Server; url: string }> {
  return new Promise((resolve, reject) => {
    // reason: serve() types the result as a union with http2 servers; we pass no http2 options.
    const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
      const host = info.family === 'IPv6' ? `[${info.address}]` : info.address
      server.off('error', reject)
      resolve({ server, url: `http://${host}:${info.port}` })
    }) as Server
    server.once('error', reject)
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    const force = setTimeout(() => server.closeAllConnections(), CONNECTION_GRACE_MS)
    server.close(() => {
      clearTimeout(force)
      resolve()
    })
    server.closeIdleConnections()
  })
}

/**
 * Boot order: master key, database, migrations, then listen. Anything that fails after the
 * database opened closes it before the error propagates.
 */
export async function startServer(
  config: Config,
  overrides: BootOverrides = {},
): Promise<RunningServer> {
  const logger = overrides.logger ?? createLogger({ level: config.logLevel })
  const version = readVersion()

  const masterKey = await loadOrCreateMasterKey(config.secretsDir, {
    onWarning: (message) => logger.warn(message),
  })
  let secretBox: SecretBox
  try {
    secretBox = await createSecretBox(masterKey)
  } finally {
    masterKey.fill(0)
  }

  // The opaque id every Sign in with ChatGPT credential on this server shares. Read before the
  // database opens, so a bad file leaves nothing to close.
  const hostId = await loadOrCreateHostId(config.secretsDir)

  const handle = (overrides.createDb ?? createDb)(config.databaseUrl, {
    // Idle client errors must not crash the process. Name and code only: messages can hold the url.
    onError: (err) =>
      logger.error(
        { errName: err.name, code: (err as { code?: unknown }).code },
        'database pool error',
      ),
  })
  let server: Server
  let url: string
  let providers: ReturnType<typeof createProviderService>
  try {
    await (overrides.migrate ?? migrate)(handle.db, resolveMigrationsFolder())
    logger.info('migrations applied')
    providers = createProviderService({
      db: handle.db,
      secretBox,
      logger,
      chatgpt: { hostId, port: config.siwcPort, bindHost: config.siwcHost },
    })
    const app = createApp({
      logger,
      version,
      providers,
      checkDb: async () => {
        await probeDb(handle.pool, HEALTH_QUERY_TIMEOUT_MS)
      },
    })
    ;({ server, url } = await listen(app, config))
  } catch (err) {
    await handle.close().catch(() => {})
    throw err
  }

  logger.info({ url, host: config.host, port: config.port, version }, 'listening')

  let stopping: Promise<void> | undefined
  return {
    url,
    secretBox,
    stop() {
      stopping ??= (async () => {
        await closeServer(server)
        await providers.close()
        await handle.close()
        logger.info('stopped')
      })()
      return stopping
    },
  }
}
