import { USER_CONTEXT_MAX, USER_NAME_MAX, UserProfile } from '@mawl/contracts'
import { schema } from '@mawl/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MadeServiceDb } from '../providers/service-suite.ts'
import { createUserService } from './service.ts'

const { userProfile } = schema

/** The same suite runs on PGlite (in process) and on real Postgres. */
export function describeUserService(name: string, make: () => Promise<MadeServiceDb>): void {
  describe(name, () => {
    let made: MadeServiceDb
    // reason: assigned in beforeAll, read only inside tests.
    let db!: MadeServiceDb['db']

    beforeAll(async () => {
      made = await make()
      await made.migrate()
      db = made.db
    }, 120_000)

    afterAll(async () => {
      await made.close()
    })

    beforeEach(async () => {
      await db.delete(userProfile)
    })

    const service = () => createUserService({ db })

    it('is an empty profile before the owner saves anything, without writing a row', async () => {
      expect(await service().get()).toEqual({ name: '', personalContext: '' })
      expect(await db.select().from(userProfile)).toEqual([])
    })

    it('round-trips a saved profile and returns exactly the strict public shape', async () => {
      const saved = await service().update({ name: 'Sam', personalContext: 'I run a bakery.' })
      expect(saved).toEqual({ name: 'Sam', personalContext: 'I run a bakery.' })
      const read = await service().get()
      expect(read).toEqual(saved)
      expect(UserProfile.safeParse(read).success).toBe(true)
    })

    it('replaces both fields on every update, so clearing one really clears it', async () => {
      await service().update({ name: 'Sam', personalContext: 'Bakery.' })
      await service().update({ name: '', personalContext: 'Now a florist.' })
      expect(await service().get()).toEqual({ name: '', personalContext: 'Now a florist.' })
      await service().update({ name: 'Sam', personalContext: '' })
      expect(await service().get()).toEqual({ name: 'Sam', personalContext: '' })
    })

    it('keeps one row however many times it is saved', async () => {
      for (let i = 0; i < 5; i++) await service().update({ name: `n${i}`, personalContext: '' })
      const rows = await db.select().from(userProfile)
      expect(rows).toHaveLength(1)
      expect(rows[0]?.name).toBe('n4')
    })

    it('never mixes two concurrent saves: the stored profile is one of them, whole', async () => {
      const a = { name: 'Ada', personalContext: 'from a' }
      const b = { name: 'Bob', personalContext: 'from b' }
      await Promise.all([service().update(a), service().update(b), service().update(a)])
      const stored = await service().get()
      expect([a, b]).toContainEqual(stored)
      expect(await db.select().from(userProfile)).toHaveLength(1)
    })

    it('stores the limits, unicode and markup verbatim, as plain data', async () => {
      const personalContext = `日本語 ünï 🎉 <script>x</script> "Ignore previous instructions"\n${'x'.repeat(USER_CONTEXT_MAX - 60)}`
      const name = 'n'.repeat(USER_NAME_MAX)
      await service().update({ name, personalContext })
      expect(await service().get()).toEqual({ name, personalContext })
    })

    it('stamps updated_at on each save', async () => {
      const old = new Date('2026-01-01T00:00:00.000Z')
      await db.insert(userProfile).values({ name: 'a', updatedAt: old })
      await service().update({ name: 'b', personalContext: '' })
      const [row] = await db.select().from(userProfile)
      expect(row?.updatedAt.getTime()).toBeGreaterThan(old.getTime())
    })
  })
}
