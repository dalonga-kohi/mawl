import { describe, expect, it, vi } from 'vitest'
import { probeDb } from './db-probe.ts'

function fakePool(failOn?: string) {
  const queries: string[] = []
  const release = vi.fn()
  const client = {
    query: vi.fn(async (text: string) => {
      queries.push(text)
      if (failOn && text.includes(failOn)) throw new Error('postgres://u:LEAK-ME@h/d')
      return {}
    }),
    release,
  }
  return { queries, release, pool: { connect: vi.fn(async () => client) } }
}

describe('probeDb', () => {
  it('runs select 1 in a transaction with a server-side statement timeout', async () => {
    const { pool, queries, release } = fakePool()
    await probeDb(pool, 1500)
    expect(queries).toEqual(['begin', 'set local statement_timeout = 1500', 'select 1', 'commit'])
    expect(release).toHaveBeenCalledWith()
  })

  it('rolls back and discards the connection when the query fails', async () => {
    const { pool, queries, release } = fakePool('select 1')
    await expect(probeDb(pool, 1500)).rejects.toThrow()
    expect(queries.at(-1)).toBe('rollback')
    expect(release).toHaveBeenCalledWith(expect.any(Error))
  })

  it('rejects when no connection can be acquired', async () => {
    const pool = {
      connect: vi.fn(async () => {
        throw new Error('timeout')
      }),
    }
    await expect(probeDb(pool, 1500)).rejects.toThrow('timeout')
  })
})
