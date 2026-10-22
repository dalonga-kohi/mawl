import { existsSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { ABORT_SHUTDOWN, type ProfileRecord, type ResolvedModel, type RunRecord } from '@mawl/core'
import { createDb, type DbHandle, migrate, migrationsFolder } from '@mawl/db'
import { createApp } from './app.ts'
import {
  type ClaudeBinaryManifest,
  createClaudeExecutableResolver,
  embeddedClaudeManifest,
  ensureClaudeBinary,
} from './claude-binary/index.ts'
import type { Config, EmbeddedPgConfig } from './config.ts'
import { probeDb } from './db-probe.ts'
import { type EmbeddedPostgres, startEmbeddedPostgres } from './embedded-pg/index.ts'
import { createLiveEvents, type LiveEvents } from './events/live.ts'
import { createEventsService } from './events/service.ts'
import { createPgSource } from './events/source.ts'
import { attachWsHub, type WsHub } from './events/ws.ts'
import { createLogger, type Logger } from './logger.ts'
import { createProfileService } from './profiles/service.ts'
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
import { runTeardown } from './teardown.ts'
import { createUserService } from './user/service.ts'
import { readVersion } from './version.ts'
import { resolveWebDir } from './web-static.ts'

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
  /** Replaces the D1.1 embedded Postgres (desktop mode without DATABASE_URL). */
  startEmbeddedPostgres?: typeof startEmbeddedPostgres
  /**
   * Receives a stop for anything boot started that must not outlive the process (the embedded
   * Postgres), for the lifecycle's hard-exit paths that skip stop(). Idempotent, never rejects.
   */
  registerEmergencyStop?: (stop: () => Promise<unknown>) => void
  /** Replaces the build-embedded Claude binary pin (absent when running from source). */
  claudeManifest?: ClaudeBinaryManifest
  /** Replaces the first-use Claude binary download. */
  ensureClaudeBinary?: typeof ensureClaudeBinary
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

function webDirOption(config: Config): { webDir?: string } {
  const webDir = resolveWebDir(config.webDir)
  return webDir ? { webDir } : {}
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
 * coalescer, event bus, providers, database, then the embedded Postgres when desktop mode started one
 * (it starts right after the secrets and is stopped on any later boot failure too).
 */
export async function startServer(
  config: Config,
  overrides: BootOverrides = {},
): Promise<RunningServer> {
  if (!config.databaseUrl && !config.embeddedPg) {
    throw new Error('no database configured: set DATABASE_URL, or MAWL_PG_ROOT in desktop mode')
  }
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

  // Desktop mode without DATABASE_URL: the bundled Postgres, started after the secrets (a bad
  // secrets dir leaves nothing to stop) and stopped last, also when boot fails below.
  let embeddedPg: EmbeddedPostgres | undefined
  let databaseUrl: string
  if (config.databaseUrl) {
    databaseUrl = config.databaseUrl
  } else {
    // Checked at the top, before anything was created.
    const roots = config.embeddedPg as EmbeddedPgConfig
    const pg = await (overrides.startEmbeddedPostgres ?? startEmbeddedPostgres)({
      ...roots,
      logger,
    })
    embeddedPg = pg
    overrides.registerEmergencyStop?.(() => pg.stop())
    databaseUrl = pg.connectionString
    void pg.exited.then((exit) => {
      if (!exit.expected) {
        // The server keeps answering, with /healthz at 503, so the desktop host restarts it.
        logger.error({ code: exit.code, signal: exit.signal }, 'embedded postgres exited')
      }
    })
  }

  let handle: DbHandle
  try {
    handle = (overrides.createDb ?? createDb)(databaseUrl, {
      // Idle client errors must not crash the process. Name and code only: messages can hold the url.
      onError: (err) =>
        logger.error(
          { errName: err.name, code: (err as { code?: unknown }).code },
          'database pool error',
        ),
    })
  } catch (err) {
    await embeddedPg?.stop()
    throw err
  }
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
        // Looked up (desktop: downloaded) when the Claude plan is first tested or used, not now.
        resolveExecutable: createClaudeExecutableResolver({
          explicitPath: config.claudeCodePath,
          dataDir: config.dataDir,
          manifest: overrides.claudeManifest ?? embeddedClaudeManifest(),
          logger,
          ensure: overrides.ensureClaudeBinary ?? ensureClaudeBinary,
        }),
      },
    })
    // Set before anything else can fail, so the catch below can close it.
    providers = providerService
    if (overrides.events !== false) {
      live = createLiveEvents({
        db: handle.db,
        source: createPgSource(databaseUrl),
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
    const profileService = createProfileService({ db: handle.db })
    const userService = createUserService({ db: handle.db })
    const app = createApp({
      hosts: { bindHost: config.host, allowedOrigins: config.allowedOrigins ?? [] },
      ...webDirOption(config),
      logger,
      version,
      providers: providerService,
      runs,
      profiles: profileService,
      user: userService,
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
          profiles: profileService,
          user: userService,
          events: createEventsService({ bus: live.bus }),
        }),
        logger,
        allowedOrigins: config.allowedOrigins,
        bindHost: config.host,
      })
    }
  } catch (err) {
    providers?.abortPending()
    registry.abortAll(ABORT_SHUTDOWN)
    await worker?.stop().catch(() => {})
    await live?.stop().catch(() => {})
    await providers?.close().catch(() => {})
    await handle.close().catch(() => {})
    await embeddedPg?.stop()
    throw err
  }

  logger.info({ url, host: config.host, port: config.port, version }, 'listening')

  let stopping: Promise<void> | undefined
  return {
    url,
    secretBox,
    stop() {
      stopping ??= (async () => {
        // Every step runs even when an earlier one fails; the errors are rethrown at the end.
        await runTeardown([
          // Sockets first: closing them ends the subscription streams that would hold the listener open.
          () => hub?.close(),
          () => closeServer(server),
          // A run waiting on the Claude binary download would otherwise hold the worker's stop.
          () => providers?.abortPending(),
          // Running jobs stop at once and leave their runs `running`, so the next boot resumes them.
          () => registry.abortAll(ABORT_SHUTDOWN),
          () => worker?.stop(),
          // Last deltas out while the bus can still carry them, then the bus.
          () => live?.stop(),
          () => providers?.close(),
          () => handle.close(),
          // Last, since everything above may still talk to it. Its stop() never rejects.
          () => embeddedPg?.stop(),
        ])
        logger.info('stopped')
      })()
      return stopping
    },
  }
}
