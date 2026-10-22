// Dev and test only: `pnpm --filter @mawl/server e2e:serve` (run with tsx, never bundled).
// Boots the real server on a throwaway Postgres whose runs are answered by a scripted model,
// so browser e2e needs no API key and no network. Refuses to start without MAWL_E2E=1.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb, migrate, schema } from '@mawl/db'
import { startPostgres } from '@mawl/testkit'
import { and, desc, eq } from 'drizzle-orm'
import { installLifecycle } from '../lifecycle.ts'
import { createLogger } from '../logger.ts'
import { createProviderService } from '../providers/service.ts'
import { createSecretBox, loadOrCreateMasterKey } from '../secrets/index.ts'
import { startServer } from '../server.ts'
import { createEchoResolver, E2E_CREDENTIAL_LABEL } from './echo.ts'
import { assertE2eEnv, e2eOwnerToken } from './env.ts'

const DEFAULT_PORT = 7421

let ownerToken = ''
try {
  assertE2eEnv(process.env)
  ownerToken = e2eOwnerToken(process.env)
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : 'MAWL_E2E=1 is required'}\n`)
  process.exit(1)
}

const port = Number(process.env.MAWL_PORT ?? DEFAULT_PORT)
const logger = createLogger({ level: 'info' })

async function boot() {
  const postgres = await startPostgres()
  const secretsDir = await mkdtemp(join(tmpdir(), 'mawl-e2e-'))
  const handle = createDb(postgres.url)
  let server: Awaited<ReturnType<typeof startServer>> | undefined
  const stopAll = async () => {
    await server?.stop().catch(() => {})
    await handle.close().catch(() => {})
    await postgres.stop().catch(() => {})
    await rm(secretsDir, { recursive: true, force: true })
  }

  try {
    // Seed before listening, so a passing /healthz means the credential exists.
    await migrate(handle.db)
    const masterKey = await loadOrCreateMasterKey(secretsDir)
    const secretBox = await createSecretBox(masterKey)
    masterKey.fill(0)
    const providers = createProviderService({ db: handle.db, secretBox, logger })
    if ((await providers.list()).length === 0) {
      await providers.create({
        provider: 'openai_compatible',
        label: E2E_CREDENTIAL_LABEL,
        baseUrl: 'http://127.0.0.1:9',
      })
    }
    await providers.close()

    const { messages } = schema
    // The run's own prompt is the user message written with it (same run id).
    const promptOf = async (run: { id: string }) => {
      const [row] = await handle.db
        .select({ parts: messages.parts })
        .from(messages)
        .where(and(eq(messages.runId, run.id as never), eq(messages.role, 'user')))
        .orderBy(desc(messages.createdAt))
        .limit(1)
      return (row?.parts ?? []).flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
    }

    server = await startServer(
      {
        databaseUrl: postgres.url,
        host: '127.0.0.1',
        port,
        secretsDir,
        siwcPort: 1455,
        siwcHost: '127.0.0.1',
        logLevel: 'info',
        ownerToken,
      },
      { logger, resolveModel: createEchoResolver(promptOf) },
    )
  } catch (err) {
    await stopAll()
    throw err
  }
  return { url: server.url, stop: stopAll }
}

const booting = boot()
installLifecycle({
  logger,
  stop: async () => (await booting).stop(),
  booted: booting,
  exit: (code) => process.exit(code),
  proc: process,
})
booting.then(
  ({ url }) => logger.info({ url }, 'e2e server listening'),
  (err: unknown) => {
    logger.fatal({ errName: err instanceof Error ? err.name : 'unknown' }, 'e2e boot failed')
    process.exit(1)
  },
)
