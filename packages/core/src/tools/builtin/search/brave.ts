import { z } from 'zod'
import { plain, readJson, send, webUrl } from './http.ts'
import { SearchFailedError, type SearchFetch, type SearchProvider } from './types.ts'

/** Brave Search web endpoint (api-dashboard.search.brave.com docs, checked 2026-10-24). */
export const BRAVE_SEARCH_URL = 'https://api.search.brave.com/res/v1/web/search'

const BraveResponse = z.looseObject({
  web: z
    .looseObject({
      results: z
        .array(
          z.looseObject({
            title: z.string(),
            url: z.string(),
            description: z.string().optional(),
          }),
        )
        .optional(),
    })
    .optional(),
})

/**
 * Brave Search backend. The key goes in the `X-Subscription-Token` header only (never the url),
 * redirects are refused so it can never be sent elsewhere, and no response text is kept on error.
 */
export function braveSearch({
  apiKey,
  fetch,
}: {
  apiKey: string
  fetch: SearchFetch
}): SearchProvider {
  return {
    name: 'brave',
    async search(query, { count, signal }) {
      const url = new URL(BRAVE_SEARCH_URL)
      url.searchParams.set('q', query)
      url.searchParams.set('count', String(count))
      const res = await send(
        fetch,
        url.href,
        { method: 'GET', headers: { accept: 'application/json', 'x-subscription-token': apiKey } },
        signal,
      )
      const parsed = BraveResponse.safeParse(await readJson(res, signal))
      if (!parsed.success) throw new SearchFailedError('unavailable')
      return {
        backend: 'brave',
        results: (parsed.data.web?.results ?? [])
          .filter((r) => webUrl(r.url) !== null)
          .slice(0, count)
          .map((r) => ({
            title: plain(r.title, 200),
            url: r.url,
            snippet: plain(r.description ?? '', 500),
          })),
      }
    },
  }
}
