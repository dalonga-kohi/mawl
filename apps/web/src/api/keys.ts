import type { ProfileId, RunId, ThreadId } from '@mawl/contracts'

/**
 * Query keys in the exact shape @orpc/tanstack-query generates (`[path, { input?, type }]`), so the
 * event store's invalidations (`utils.threads.key()`, `utils.runs.key()`) reach the queries the views
 * read. keys.test.ts pins the shape against the real utils.
 */
const op = (path: readonly string[], type: 'query' | 'infinite', input?: unknown) =>
  [path, { ...(input !== undefined ? { input } : {}), type }] as const

export const MESSAGE_PAGE = 50

export const keys = {
  profiles: () => op(['profiles', 'list'], 'query'),
  threads: (profileId: ProfileId) => op(['threads', 'list'], 'query', { profileId }),
  messages: (threadId: ThreadId) =>
    op(['threads', 'messages'], 'infinite', { threadId, limit: MESSAGE_PAGE }),
  run: (id: RunId) => op(['runs', 'get'], 'query', { id }),
}
