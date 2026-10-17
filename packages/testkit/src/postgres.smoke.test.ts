import pg from 'pg'
import { describe, expect, it } from 'vitest'
import { withPostgres } from './postgres'

describe('withPostgres (pgvector)', () => {
  const url = withPostgres()

  it('serves a database with the vector extension available', async () => {
    const client = new pg.Client({ connectionString: url() })
    try {
      await client.connect()
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
      const res = await client.query<{ v: string }>("SELECT '[1,2,3]'::vector AS v")
      expect(res.rows[0]?.v).toBe('[1,2,3]')
    } finally {
      await client.end()
    }
  })
})
