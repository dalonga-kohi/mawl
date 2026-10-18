import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ABORT_SHUTDOWN, type ProfileRecord, type ResolvedModel, type RunRecord } from '@faire/core'
import { createDb, migrate, migrationsFolder } from '@faire/db'
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import type { Config } from './config.ts'
import { probeDb } from './db-probe.ts'
import { createLiveEvents, type LiveEvents } from './events/live.ts'
import { createEventsService } from './events/service.ts'
import { createPgSource } from './events/source.ts'
import { attachWsHub, type WsHub } from './events/ws.ts'
import { createLogger, type Logger } from './logger.ts'
import { createProviderService } from './providers/service.ts'
import { createRouter } from './router.ts'
import { RunRegistry } from './runs/registry.ts'
import { createModelResolver } from './runs/resolve-model.ts'
import { createRunService } from './runs/service.ts'
import { type RunWorker, startRunWorker } from './runs/worker.ts'
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
  /** When false, no Graphile Worker starts (unit tests with a fake database); runs then stay queued. */
  worker?: boolean
  /** When false, no event bus, delta coalescer or /ws hub starts (unit tests with a fake database). */
  events?: boolean
  /** Replaces the provider-backed model lookup, so tests can run the engine with a fake model. */
  resolveModel?: (run: RunRecord, profile: ProfileRecord) => Promise<ResolvedModel>
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
 * Boot order: master key, database, migrations, the Graphile Worker (its own migrations, then
 * recovery of unfinished runs), the event bus (before the worker, so no event is missed), then listen
 * and attach the /ws hub. Anything that fails after the database opened closes
 * it before the error propagates. Stop order: sockets, listener, abort running jobs, worker, delta
 * coalescer, event bus, providers, database.
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
  let providers: ReturnType<typeof createProviderService> | undefined
  let worker: RunWorker | undefined
  let live: LiveEvents | undefined
  let hub: WsHub | undefined
  const registry = new RunRegistry()
  try {
    await (overrides.migrate ?? migrate)(handle.db, resolveMigrationsFolder())
    logger.info('migrations applied')
    const providerService = createProviderService({
      db: handle.db,
      secretBox,
      logger,
      chatgpt: { hostId, port: config.siwcPort, bindHost: config.siwcHost },
      claudeCode: {
        configDir: config.claudeConfigDir,
        pathToClaudeCodeExecutable: config.claudeCodePath,
      },
    })
    // Set before anything else can fail, so the catch below can close it.
    providers = providerService
    if (overrides.events !== false) {
      live = createLiveEvents({
        db: handle.db,
        source: createPgSource(config.databaseUrl),
        logger,
      })
      await live.start()
    }
    if (overrides.worker !== false) {
      worker = await startRunWorker({
        pool: handle.pool,
        db: handle.db,
        logger,
        registry,
        resolveModel: overrides.resolveModel ?? createModelResolver(providerService),
        ...(live ? { deltas: live.deltas } : {}),
      })
      logger.info('run worker started')
      // Runs a previous process left queued or running: their jobs may be lost or locked.
      const recovered = await worker.recover()
      if (recovered > 0) logger.info({ runs: recovered }, 'recovered unfinished runs')
    }
    const runs = createRunService({
      db: handle.db,
      registry,
      logger,
      enqueue: (runId) => (worker ? worker.enqueue(runId) : Promise.resolve()),
    })
    const app = createApp({
      hosts: { bindHost: config.host, allowedOrigins: config.allowedOrigins ?? [] },
      logger,
      version,
      providers: providerService,
      runs,
      checkDb: async () => {
        await probeDb(handle.pool, HEALTH_QUERY_TIMEOUT_MS)
      },
    })
    ;({ server, url } = await listen(app, config))
    if (live) {
      hub = attachWsHub({
        server,
        router: createRouter({
          version,
          providers: providerService,
          runs,
          events: createEventsService({ bus: live.bus }),
        }),
        logger,
        allowedOrigins: config.allowedOrigins,
        bindHost: config.host,
      })
    }
  } catch (err) {
    registry.abortAll(ABORT_SHUTDOWN)
    await worker?.stop().catch(() => {})
    await live?.stop().catch(() => {})
    await providers?.close().catch(() => {})
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
        // Sockets first: closing them ends the subscription streams that would hold the listener open.
        await hub?.close()
        await closeServer(server)
        // Running jobs stop at once and leave their runs `running`, so the next boot resumes them.
        registry.abortAll(ABORT_SHUTDOWN)
        await worker?.stop()
        // Last deltas out while the bus can still carry them, then the bus.
        await live?.stop()
        await providers?.close()
        await handle.close()
        logger.info('stopped')
      })()
      return stopping
    },
  }
}
