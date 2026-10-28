import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, describe, expect, it } from 'vitest'
import { migrationsFolder } from './index.ts'
import * as schema from './schema.ts'

const { serviceCredentials } = schema

/** A copy of the migrations folder whose journal stops at `lastIdx`. */
function migrationsUpTo(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'mawl-migrations-'))
  cpSync(migrationsFolder, dir, { recursive: true })
  const journalPath = join(dir, 'meta', '_journal.json')
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number }[]
  }
  journal.entries = journal.entries.filter((e) => e.idx <= lastIdx)
  writeFileSync(journalPath, JSON.stringify(journal))
  return dir
}

describe('migration 0008 (search backend keys) on existing data, PGlite', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const before = migrationsUpTo(7)
  afterAll(async () => {
    await client.close()
    rmSync(before, { recursive: true, force: true })
  })

  it('keeps a stored Brave key and then accepts a Tavily key, still rejecting unknown services', async () => {
    await migrate(db, { migrationsFolder: before })
    const blob = Uint8Array.from({ length: 48 }, (_, i) => i)
    await db.insert(serviceCredentials).values({ service: 'brave_search', secretEnc: blob })
    await expect(
      db.insert(serviceCredentials).values({ service: 'tavily_search', secretEnc: blob }),
    ).rejects.toThrow()

    await migrate(db, { migrationsFolder })

    const [brave] = await db.select().from(serviceCredentials)
    expect(brave?.service).toBe('brave_search')
    expect(Array.from(brave?.secretEnc ?? [])).toEqual(Array.from(blob))
    await db.insert(serviceCredentials).values({ service: 'tavily_search', secretEnc: blob })
    await expect(
      db.insert(serviceCredentials).values({
        service: 'bing' as unknown as 'brave_search',
        secretEnc: blob,
      }),
    ).rejects.toThrow()
    expect(await db.select().from(serviceCredentials)).toHaveLength(2)
  }, 120_000)
})
