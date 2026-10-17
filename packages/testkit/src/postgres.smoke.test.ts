import pg from 'pg'
import { expect, it } from 'vitest'
import { describeWithPostgres, startPostgres } from './postgres'

await describeWithPostgres('startPostgres (pgvector)', () => {
  it('serves a database with the vector extension available', async () => {
    const db = await startPostgres()
    const client = new pg.Client({ connectionString: db.url })
    try {
      await client.connect()
      await client.query('CREATE EXTENSION IF NOT EXISTS vector')
      const res = await client.query<{ v: string }>("SELECT '[1,2,3]'::vector AS v")
      expect(res.rows[0]?.v).toBe('[1,2,3]')
    } finally {
      await client.end()
      await db.stop()
    }
  }, 120_000)
})
