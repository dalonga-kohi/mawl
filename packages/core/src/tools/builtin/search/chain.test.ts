import { afterEach, describe, expect, it, vi } from 'vitest'
import { chainedSearch } from './chain.ts'
import {
  type SearchAnswer,
  SearchFailedError,
  type SearchFailureReason,
  type SearchProvider,
  SearchUnavailableError,
} from './types.ts'

const signal = () => new AbortController().signal

function answering(name: string): SearchProvider & { search: ReturnType<typeof vi.fn> } {
  return {
    name,
    search: vi.fn(
      async (): Promise<SearchAnswer> => ({
        backend: name,
        results: [{ title: name, url: `https://${name}.example/`, snippet: '' }],
      }),
    ),
  }
}

function failing(name: string, reason: SearchFailureReason) {
  return {
    name,
    search: vi.fn(async (): Promise<SearchAnswer> => {
      throw new SearchFailedError(reason)
    }),
  }
}

/** A backend that never answers; it rejects with the signal's reason when aborted. */
function hanging(name: string) {
  return {
    name,
    search: vi.fn(
      (_q: string, { signal: s }: { count: number; signal: AbortSignal }) =>
        new Promise<SearchAnswer>((_resolve, reject) => {
          s.addEventListener('abort', () => reject(s.reason), { once: true })
        }),
    ),
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('chainedSearch', () => {
  it('answers from the first backend and does not call the rest', async () => {
    const a = answering('tavily')
    const b = answering('brave')
    const answer = await chainedSearch([a, b]).search('q', { count: 3, signal: signal() })
    expect(answer.backend).toBe('tavily')
    expect(a.search).toHaveBeenCalledWith('q', expect.objectContaining({ count: 3 }))
    expect(b.search).not.toHaveBeenCalled()
  })

  it('falls through a failing backend in order and says which one answered', async () => {
    const a = failing('tavily', 'invalid_key')
    const b = failing('brave', 'rate_limited')
    const c = answering('ddgs')
    const answer = await chainedSearch([a, b, c]).search('q', { count: 3, signal: signal() })
    expect(answer.backend).toBe('ddgs')
    expect(a.search).toHaveBeenCalled()
    expect(b.search).toHaveBeenCalled()
  })

  it('an empty answer is an answer: it does not fall through', async () => {
    const a: SearchProvider = {
      name: 'tavily',
      search: async () => ({ backend: 'tavily', results: [] }),
    }
    const b = answering('ddgs')
    expect(await chainedSearch([a, b]).search('q', { count: 3, signal: signal() })).toEqual({
      backend: 'tavily',
      results: [],
    })
    expect(b.search).not.toHaveBeenCalled()
  })

  it('throws every backend with its closed reason when none answers', async () => {
    const err = await chainedSearch([
      failing('tavily', 'invalid_key'),
      failing('brave', 'rate_limited'),
      failing('ddgs', 'unavailable'),
    ])
      .search('q', { count: 3, signal: signal() })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SearchUnavailableError)
    expect((err as SearchUnavailableError).failures).toEqual([
      { backend: 'tavily', reason: 'invalid_key' },
      { backend: 'brave', reason: 'rate_limited' },
      { backend: 'ddgs', reason: 'unavailable' },
    ])
  })

  it('gives a backend that does not answer in time up as unavailable and moves on', async () => {
    vi.useFakeTimers()
    const slow = hanging('tavily')
    const pending = chainedSearch([slow, answering('ddgs')], { backendTimeoutMs: 1000 }).search(
      'q',
      { count: 3, signal: signal() },
    )
    await vi.advanceTimersByTimeAsync(1001)
    expect((await pending).backend).toBe('ddgs')
  })

  it('reports a timed-out last backend as unavailable', async () => {
    vi.useFakeTimers()
    const pending = chainedSearch([hanging('ddgs')], { backendTimeoutMs: 1000 })
      .search('q', { count: 3, signal: signal() })
      .catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(1001)
    expect(((await pending) as SearchUnavailableError).failures).toEqual([
      { backend: 'ddgs', reason: 'unavailable' },
    ])
  })

  it('an abort from the caller propagates and never falls through', async () => {
    const c = new AbortController()
    const slow = hanging('tavily')
    const next = answering('ddgs')
    const pending = chainedSearch([slow, next]).search('q', { count: 3, signal: c.signal })
    const cause = new Error('cancelled')
    c.abort(cause)
    await expect(pending).rejects.toBe(cause)
    expect(next.search).not.toHaveBeenCalled()
  })

  it('does not start any backend when the caller already aborted', async () => {
    const c = new AbortController()
    c.abort(new Error('cancelled'))
    const a = answering('tavily')
    await expect(chainedSearch([a]).search('q', { count: 3, signal: c.signal })).rejects.toThrow(
      'cancelled',
    )
    expect(a.search).not.toHaveBeenCalled()
  })

  it('lets an unexpected error (a bug, not a backend failure) propagate', async () => {
    const boom = new RangeError('bug')
    const a: SearchProvider = {
      name: 'tavily',
      search: async () => {
        throw boom
      },
    }
    const next = answering('ddgs')
    await expect(chainedSearch([a, next]).search('q', { count: 3, signal: signal() })).rejects.toBe(
      boom,
    )
    expect(next.search).not.toHaveBeenCalled()
  })

  it('passes each backend a signal that follows the caller', async () => {
    const c = new AbortController()
    let seen: AbortSignal | undefined
    const a: SearchProvider = {
      name: 'tavily',
      search: async (_q, o) => {
        seen = o.signal
        return { backend: 'tavily', results: [] }
      },
    }
    await chainedSearch([a]).search('q', { count: 1, signal: c.signal })
    c.abort()
    expect(seen?.aborted).toBe(true)
  })
})
