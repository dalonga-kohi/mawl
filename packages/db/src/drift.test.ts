import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api'
import { describe, expect, it } from 'vitest'
import { migrationsFolder } from './index.ts'
import * as schema from './schema.ts'

type Snapshot = Parameters<typeof generateMigration>[0]

describe('migration drift guard', () => {
  it('schema.ts matches the latest committed snapshot (run `pnpm db:generate` if not)', async () => {
    const metaDir = join(migrationsFolder, 'meta')
    const latest = readdirSync(metaDir)
      .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
      .sort()
      .at(-1)
    expect(latest, 'no snapshot found').toBeDefined()
    const prev = JSON.parse(readFileSync(join(metaDir, latest as string), 'utf8')) as Snapshot
    const cur = generateDrizzleJson(schema)
    expect(await generateMigration(prev, cur)).toEqual([])
  })

  it('every journal entry has a SQL file', () => {
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
    ) as {
      entries: { tag: string }[]
    }
    const files = new Set(readdirSync(migrationsFolder))
    for (const e of journal.entries) expect(files.has(`${e.tag}.sql`), e.tag).toBe(true)
  })
})
