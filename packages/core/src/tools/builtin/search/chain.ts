import {
  SearchFailedError,
  type SearchFailure,
  type SearchProvider,
  SearchUnavailableError,
} from './types.ts'

/** How long one backend of a chain gets before the next one is tried. */
export const SEARCH_BACKEND_TIMEOUT_MS = 6_000

/**
 * Tries the backends in order (Tavily, Brave, DDGS) and returns the first answer, which names the
 * backend that gave it. A backend that fails with a `SearchFailedError` or does not answer within
 * `backendTimeoutMs` is recorded as `{ backend, reason }` and the next one is tried; an empty
 * answer is an answer. The caller's abort and any other error propagate at once and never fall
 * through. When no backend answers, a `SearchUnavailableError` lists each with its closed reason.
 */
export function chainedSearch(
  providers: readonly SearchProvider[],
  { backendTimeoutMs = SEARCH_BACKEND_TIMEOUT_MS }: { backendTimeoutMs?: number } = {},
): SearchProvider {
  return {
    name: providers.map((p) => p.name).join(','),
    async search(query, { count, signal }) {
      const failures: SearchFailure[] = []
      for (const provider of providers) {
        signal.throwIfAborted()
        const timer = new AbortController()
        const handle = setTimeout(() => timer.abort(new Error('timeout')), backendTimeoutMs)
        try {
          return await provider.search(query, {
            count,
            signal: AbortSignal.any([signal, timer.signal]),
          })
        } catch (err) {
          if (signal.aborted) throw err
          if (timer.signal.aborted) {
            failures.push({ backend: provider.name, reason: 'unavailable' })
          } else if (err instanceof SearchFailedError) {
            failures.push({ backend: provider.name, reason: err.reason })
          } else {
            throw err
          }
        } finally {
          clearTimeout(handle)
        }
      }
      throw new SearchUnavailableError(failures)
    },
  }
}
