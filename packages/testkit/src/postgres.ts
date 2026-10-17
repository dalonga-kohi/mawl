import { describe } from 'vitest'

export const DEFAULT_PG_IMAGE = 'pgvector/pgvector:pg17'
const DOCKER_PROBE_TIMEOUT_MS = 3000

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

let cachedAvailability: Promise<boolean> | undefined
let logged = false

/**
 * `describe` for suites that need Docker Postgres. Skips (and logs one line why) when
 * Docker is unavailable. Await it at the top level of the test file:
 *   await describeWithPostgres('repo', () => { ... })
 */
export async function describeWithPostgres(
  name: string,
  fn: () => void,
  opts: { isAvailable?: () => Promise<boolean> } = {},
): Promise<void> {
  const available = await (
    opts.isAvailable ?? (() => (cachedAvailability ??= isDockerAvailable()))
  )()
  if (!available && !logged) {
    logged = true
    process.stderr.write(
      '[testkit] Docker is not available: skipping Postgres integration suites\n',
    )
  }
  describe.skipIf(!available)(name, fn)
}
