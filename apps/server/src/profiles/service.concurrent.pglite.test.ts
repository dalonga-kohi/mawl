import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { type CredentialId, newId } from '@faire/contracts'
import { migrationsFolder, schema } from '@faire/db'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createProfileService } from './service.ts'

describe('profile service under concurrency (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  let cred: CredentialId

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
    cred = newId('credential')
    await db
      .insert(schema.providerCredentials)
      .values({ id: cred, provider: 'openai', label: 'Test', secretEnc: Buffer.from('x') })
  }, 120_000)
  afterAll(async () => {
    await client.close()
  })
  beforeEach(async () => {
    await db.delete(schema.profiles)
  })

  const model = () => `${cred}:fake-echo`

  it('gives distinct slugs to teammates with the same name created at the same time', async () => {
    const service = createProfileService({ db })
    const made = await Promise.all(
      Array.from({ length: 4 }, () => service.create({ name: 'Ada', modelMain: model() })),
    )
    const slugs = made.map((p) => p.slug)
    expect(new Set(slugs).size).toBe(4)
    expect(slugs.every((s) => /^ada(-\d+)?$/.test(s))).toBe(true)
  })

  it('lets exactly one of two simultaneous creates win an explicit slug', async () => {
    const service = createProfileService({ db })
    const results = await Promise.allSettled([
      service.create({ name: 'A', slug: 'same', modelMain: model() }),
      service.create({ name: 'B', slug: 'same', modelMain: model() }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const lost = results.find((r) => r.status === 'rejected')
    expect(lost).toMatchObject({ reason: { name: 'SlugTakenError', slug: 'same' } })
  })

  it('archives the same teammate twice at once without error', async () => {
    const service = createProfileService({ db })
    const p = await service.create({ name: 'Ada', modelMain: model() })
    const [a, b] = await Promise.all([service.archive(p.id), service.archive(p.id)])
    expect(a.archivedAt).not.toBeNull()
    expect(b.archivedAt).not.toBeNull()
    expect(await service.list()).toEqual([])
  })
})
