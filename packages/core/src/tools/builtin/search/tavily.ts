import { z } from 'zod'
import { plain, readJson, send } from './http.ts'
import { SearchFailedError, type SearchFetch, type SearchProvider } from './types.ts'

/** Tavily search endpoint (docs.tavily.com api-reference/endpoint/search, checked 2026-10-28). */
export const TAVILY_SEARCH_URL = 'https://api.tavily.com/search'

const TavilyResponse = z.looseObject({
  results: z.array(
    z.looseObject({
      title: z.string(),
      url: z.string(),
      content: z.string().optional(),
    }),
  ),
})

/**
 * Tavily backend. The key goes in the `Authorization: Bearer` header only (never the url or the
 * body); `search_depth: basic` costs one credit. Redirects are refused and no response text is
 * kept on error. Tavily's plan limits (432, 433) count as rate limited.
 */
export function tavilySearch({
  apiKey,
  fetch,
}: {
  apiKey: string
  fetch: SearchFetch
}): SearchProvider {
  return {
    name: 'tavily',
    async search(query, { count, signal }) {
      const res = await send(
        fetch,
        TAVILY_SEARCH_URL,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ query, max_results: count, search_depth: 'basic' }),
        },
        signal,
      )
      const parsed = TavilyResponse.safeParse(await readJson(res, signal))
      if (!parsed.success) throw new SearchFailedError('unavailable')
      return {
        backend: 'tavily',
        results: parsed.data.results.slice(0, count).map((r) => ({
          title: plain(r.title, 200),
          url: r.url,
          snippet: plain(r.content ?? '', 500),
        })),
      }
    },
  }
}
