import { describe, expect, it } from 'vitest'
import { withAdvisoryLock } from './migrate.ts'

function fakeClient(unlockError?: Error) {
  const queries: string[] = []
  return {
    queries,
    query: async (text: string) => {
      queries.push(text)
      if (text.includes('unlock') && unlockError) throw unlockError
      return { rows: [] }
    },
  }
}

describe('withAdvisoryLock', () => {
  it('locks, runs, unlocks and returns the result', async () => {
    const c = fakeClient()
    expect(await withAdvisoryLock(c, async () => 42)).toBe(42)
    expect(c.queries).toEqual(['select pg_advisory_lock($1)', 'select pg_advisory_unlock($1)'])
  })

  it('keeps the original error when unlock also fails', async () => {
    const original = new Error('migration failed')
    const c = fakeClient(new Error('unlock failed'))
    await expect(
      withAdvisoryLock(c, async () => {
        throw original
      }),
    ).rejects.toBe(original)
  })

  it('surfaces an unlock failure when the work succeeded', async () => {
    const c = fakeClient(new Error('unlock failed'))
    await expect(withAdvisoryLock(c, async () => 1)).rejects.toThrow('unlock failed')
  })
})
