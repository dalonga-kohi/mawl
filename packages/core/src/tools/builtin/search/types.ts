export interface SearchResult {
  title: string
  url: string
  snippet: string
}

/** One backend's answer: its results and the name of the backend that gave them. */
export interface SearchAnswer {
  backend: string
  results: SearchResult[]
}

/** Why a backend failed. A closed set: backend text can echo the key, so none of it is kept. */
export type SearchFailureReason = 'invalid_key' | 'rate_limited' | 'unavailable'

/** A backend failed in a way the next backend may not share (key, quota, outage, timeout). */
export class SearchFailedError extends Error {
  constructor(readonly reason: SearchFailureReason) {
    super(`search failed: ${reason}`)
    this.name = 'SearchFailedError'
  }
}

export interface SearchFailure {
  backend: string
  reason: SearchFailureReason
}

/** No backend of a chain answered. Carries backend names and closed reasons only. */
export class SearchUnavailableError extends Error {
  constructor(readonly failures: readonly SearchFailure[]) {
    super(
      `no search backend answered: ${failures.map((f) => `${f.backend} ${f.reason}`).join(', ')}`,
    )
    this.name = 'SearchUnavailableError'
  }
}

/** A pluggable web search backend (Tavily, Brave, DDGS) or a chain of them. */
export interface SearchProvider {
  readonly name: string
  search(query: string, options: { count: number; signal: AbortSignal }): Promise<SearchAnswer>
}

export type SearchFetch = (url: string, init: RequestInit) => Promise<Response>
