import { StandardRPCJsonSerializer, StandardRPCSerializer } from '@orpc/client/standard'
import { ORPCError, onError } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { OWNER } from './auth/principal.ts'
import { bearerToken, tokenMatches } from './auth/token.ts'
import { checkHost, type HostPolicy } from './events/host.ts'
import type { Logger } from './logger.ts'
import type { ProfileService } from './profiles/service.ts'
import type { ProviderService } from './providers/service.ts'
import { createRouter } from './router.ts'
import type { RunService } from './runs/service.ts'
import type { UserService } from './user/service.ts'
import { webStatic } from './web-static.ts'

export interface AppDeps {
  logger: Logger
  version: string
  providers: ProviderService
  runs: RunService
  profiles?: ProfileService
  user?: UserService
  /** Resolves when the database answers; rejects otherwise. */
  checkDb: () => Promise<void>
  /** Health probe deadline. Defaults to 2000 ms. */
  healthTimeoutMs?: number
  /** Accepted Host headers on /rpc (DNS rebinding guard). Boot always sets it; unit tests may omit it. */
  hosts?: HostPolicy
  /** Directory of the built web app to serve at `/`. Omitted: the server only exposes the API. */
  webDir?: string
  /**
   * The token every `/rpc` call must carry as `Authorization: Bearer <token>`: the desktop launch
   * token or the headless owner token. Required, so no wiring can start an open API.
   */
  authToken: string
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2000
/** Largest `/rpc` request body. Inputs are small JSON; the biggest is a 4 KiB key or 8 KB persona. */
export const RPC_MAX_BODY_BYTES = 1024 * 1024

const rpcSerializer = new StandardRPCSerializer(new StandardRPCJsonSerializer())

/** An error response the oRPC client decodes as a plain ORPCError with this code and status. */
function rpcError(c: Context, code: string, status: 401 | 413, message: string): Response {
  const body = rpcSerializer.serialize(new ORPCError(code, { status, message }).toJSON())
  return c.json(body as object, status)
}

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
  profiles,
  user,
  checkDb,
  healthTimeoutMs,
  hosts,
  webDir,
  authToken,
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

  const rpc = new RPCHandler(
    createRouter({
      version,
      providers,
      runs,
      ...(profiles ? { profiles } : {}),
      ...(user ? { user } : {}),
    }),
    {
      // Procedure path and error code only. Inputs and outputs may hold credentials.
      clientInterceptors: [
        onError((error, { path }) => {
          const code = error instanceof ORPCError ? error.code : 'INTERNAL_SERVER_ERROR'
          logger.warn({ procedure: path.join('.'), code }, 'rpc error')
        }),
      ],
    },
  )

  // Order: Host (DNS rebinding), then the token, then the body limit, so an unauthenticated
  // caller is turned away before any of its body is read.
  app.use('/rpc/*', async (c, next) => {
    if (hosts) {
      const host = c.req.header('host')
      const verdict = checkHost(host, hosts)
      if (!verdict.ok) {
        logger.warn({ reason: verdict.reason, host: host?.slice(0, 200) }, 'rpc request rejected')
        return c.json({ ok: false }, 403)
      }
    }
    // Header only: a token in the url would end up in logs and history, so it is never read.
    if (!tokenMatches(bearerToken(c.req.header('authorization')), authToken)) {
      // Missing and wrong look the same, to the caller and in the log.
      logger.warn({ reason: 'unauthorized' }, 'rpc request rejected')
      return rpcError(c, 'UNAUTHORIZED', 401, 'Unauthorized')
    }
    await next()
  })
  app.use(
    '/rpc/*',
    bodyLimit({
      maxSize: RPC_MAX_BODY_BYTES,
      onError: (c) => {
        logger.warn({ reason: 'body_too_large', max: RPC_MAX_BODY_BYTES }, 'rpc request rejected')
        return rpcError(c, 'PAYLOAD_TOO_LARGE', 413, 'Request body too large')
      },
    }),
  )

  app.all('/rpc/*', async (c) => {
    const { matched, response } = await rpc.handle(c.req.raw, {
      prefix: '/rpc',
      // Only reached with the right token: the caller is the owner.
      context: { principal: OWNER },
    })
    return matched ? response : c.notFound()
  })

  // Last, so the API routes above always win.
  if (webDir) app.use(webStatic({ dir: webDir, hosts }))

  return app
}
