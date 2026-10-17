import { afterAll, beforeAll, beforeEach } from 'vitest'

export const DEFAULT_PG_IMAGE = 'pgvector/pgvector:0.8.7-pg17'
/** Cold Docker Desktop can take several seconds to answer. */
const DOCKER_PROBE_TIMEOUT_MS = 10_000

export interface PostgresHandle {
  /** Connection URI for the throwaway database. */
  url: string
  stop(): Promise<void>
}

/** Starts a throwaway Postgres (with pgvector by default) in Docker. */
export async function startPostgres({
  image = DEFAULT_PG_IMAGE,
}: {
  image?: string
} = {}): Promise<PostgresHandle> {
  // Lazy import: testcontainers is slow to load and most consumers only need fakeModel.
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
  const container = await new PostgreSqlContainer(image).start()
  return {
    url: container.getConnectionUri(),
    stop: async () => {
      await container.stop()
    },
  }
}

async function defaultProbe(): Promise<unknown> {
  const { getContainerRuntimeClient } = await import('testcontainers')
  return getContainerRuntimeClient()
}

/**
 * Resolves true when a Docker runtime answers within `timeoutMs`. Never throws or hangs.
 * The probe is injectable for tests.
 */
export async function isDockerAvailable(
  probe: () => Promise<unknown> = defaultProbe,
  timeoutMs = DOCKER_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  const attempt = (async () => {
    try {
      await probe()
      return true
    } catch {
      return false
    }
  })()
  try {
    return await Promise.race([attempt, timeout])
  } finally {
    clearTimeout(timer)
  }
}

const START_TIMEOUT_MS = 180_000

const isSet = (v: string | undefined) => v !== undefined && v !== '' && v !== '0' && v !== 'false'

/**
 * What to do about a Postgres suite: run when Docker is up; otherwise skip locally, but fail
 * when CI or FAIRE_REQUIRE_DOCKER is set, so CI can never go green by skipping.
 */
export function dockerPolicy(
  available: boolean,
  env: Record<string, string | undefined> = process.env,
): 'run' | 'skip' | 'fail' {
  if (available) return 'run'
  return isSet(env.CI) || isSet(env.FAIRE_REQUIRE_DOCKER) ? 'fail' : 'skip'
}

let defaultAvailability: Promise<boolean> | undefined

export interface WithPostgresOptions {
  image?: string
  /** Injectable for tests. */
  probe?: () => Promise<unknown>
  /** Injectable for tests. */
  start?: (opts: { image?: string }) => Promise<PostgresHandle>
  /** Injectable for tests. Defaults to process.env. */
  env?: Record<string, string | undefined>
}

/**
 * Call inside a (sync) describe. Registers hooks that start one Postgres for the suite
 * (beforeAll), skip every test when Docker is unavailable (beforeEach), and always stop
 * the container (afterAll, which Vitest runs even if tests throw). Returns a getter for
 * the connection url.
 *
 * Without Docker the suite is skipped and one line saying why is written to stderr (once per
 * suite), unless CI or FAIRE_REQUIRE_DOCKER is set, in which case the suite fails.
 *
 * beforeAll cannot skip in Vitest 5 (its context has no skip), so the skip happens in
 * beforeEach via TestContext.skip.
 */
export function withPostgres(opts: WithPostgresOptions = {}): () => string {
  let db: PostgresHandle | undefined
  let skipNote: string | undefined

  beforeAll(async () => {
    const available = await (opts.probe
      ? isDockerAvailable(opts.probe)
      : (defaultAvailability ??= isDockerAvailable()))
    const policy = dockerPolicy(available, opts.env)
    if (policy === 'fail') {
      throw new Error(
        'Docker is required (CI or FAIRE_REQUIRE_DOCKER is set) but is not available for Postgres tests',
      )
    }
    if (policy === 'skip') {
      skipNote = 'Docker is not available'
      process.stderr.write(`[testkit] ${skipNote}: skipping Postgres integration suite\n`)
      return
    }
    db = await (opts.start ?? startPostgres)(opts.image ? { image: opts.image } : {})
  }, START_TIMEOUT_MS)

  beforeEach((ctx) => {
    if (skipNote) ctx.skip(skipNote)
  })

  afterAll(async () => {
    const running = db
    db = undefined
    await running?.stop()
  })

  return () => {
    if (!db) throw new Error('withPostgres: url() called while Postgres is not running')
    return db.url
  }
}
