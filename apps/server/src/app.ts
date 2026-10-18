import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { Hono } from 'hono'
import { checkHost, type HostPolicy } from './events/host.ts'
import type { Logger } from './logger.ts'
import type { ProviderService } from './providers/service.ts'
import { createRouter } from './router.ts'
import type { RunService } from './runs/service.ts'

export interface AppDeps {
  logger: Logger
  version: string
  providers: ProviderService
  runs: RunService
  /** Resolves when the database answers; rejects otherwise. */
  checkDb: () => Promise<void>
  /** Health probe deadline. Defaults to 2000 ms. */
  healthTimeoutMs?: number
  /** Accepted Host headers on /rpc (DNS rebinding guard). Boot always sets it; unit tests may omit it. */
  hosts?: HostPolicy
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2000

async function isHealthy(checkDb: () => Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([
      // then(): a synchronous throw from checkDb becomes a rejection, not a 500.
      Promise.resolve()
        .then(checkDb)
        .then(
          () => true as const,
          () => false as const,
        ),
      deadline,
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function createApp({
  logger,
  version,
  providers,
  runs,
  checkDb,
  healthTimeoutMs,
  hosts,
}: AppDeps): Hono {
  const app = new Hono()

  // Request log: method, path without the query string, status, duration, request id.
  app.use(async (c, next) => {
    const requestId = crypto.randomUUID()
    const started = performance.now()
    c.header('x-request-id', requestId)
    await next()
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
        requestId,
      },
      'request',
    )
  })

  app.onError((err, c) => {
    // Name only: messages of unexpected errors can carry values we must not log.
    logger.error({ errName: err.name, path: c.req.path }, 'unhandled error')
    return c.json({ ok: false }, 500)
  })

  app.get('/healthz', async (c) => {
    const ok = await isHealthy(checkDb, healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS)
    return c.json({ ok }, ok ? 200 : 503)
  })

  const rpc = new RPCHandler(createRouter({ version, providers, runs }), {
    // Procedure path and error code only. Inputs and outputs may hold credentials.
    clientInterceptors: [
      onError((error, { path }) => {
        const code = error instanceof ORPCError ? error.code : 'INTERNAL_SERVER_ERROR'
        logger.warn({ procedure: path.join('.'), code }, 'rpc error')
      }),
    ],
  })

  app.all('/rpc/*', async (c) => {
    if (hosts) {
      const host = c.req.header('host')
      const verdict = checkHost(host, hosts)
      if (!verdict.ok) {
        logger.warn({ reason: verdict.reason, host: host?.slice(0, 200) }, 'rpc request rejected')
        return c.json({ ok: false }, 403)
      }
    }
    const { matched, response } = await rpc.handle(c.req.raw, { prefix: '/rpc', context: {} })
    return matched ? response : c.notFound()
  })

  return app
}
