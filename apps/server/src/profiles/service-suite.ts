import { type CredentialId, newId, Profile, type ProfileId } from '@faire/contracts'
import { schema } from '@faire/db'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { MadeServiceDb } from '../providers/service-suite.ts'
import { EntityNotFoundError } from '../runs/errors.ts'
import { ACCENT_PRESETS, SlugTakenError, UnknownCredentialError } from './errors.ts'
import { createProfileService } from './service.ts'

const { profiles, providerCredentials } = schema

/** The same suite runs on PGlite (in process) and on real Postgres. */
export function describeProfileService(name: string, make: () => Promise<MadeServiceDb>): void {
  describe(name, () => {
    let made: MadeServiceDb
    // reason: assigned in beforeAll, read only inside tests.
    let db!: MadeServiceDb['db']
    let cred: CredentialId

    beforeAll(async () => {
      made = await make()
      await made.migrate()
      db = made.db
      cred = newId('credential')
      await db
        .insert(providerCredentials)
        .values({ id: cred, provider: 'openai', label: 'Test', secretEnc: Buffer.from('x') })
    }, 120_000)

    afterAll(async () => {
      await made.close()
    })

    // Tests count profiles (color rotation), so each starts from an empty table.
    beforeEach(async () => {
      await db.delete(profiles)
    })

    const service = () => createProfileService({ db })
    const model = () => `${cred}:fake-echo`

    describe('create', () => {
      it('stores a profile with derived slug, default color and empty persona', async () => {
        const created = await service().create({ name: 'Ada Lovelace', modelMain: model() })
        expect(Profile.safeParse(created).success).toBe(true)
        expect(created).toMatchObject({
          name: 'Ada Lovelace',
          slug: 'ada-lovelace',
          color: ACCENT_PRESETS[0],
          personaMd: '',
          modelMain: model(),
          modelHelper: null,
          heartbeatCron: null,
          archivedAt: null,
        })
        expect(created.id).toMatch(/^prof_/)
        expect(await service().get(created.id)).toEqual(created)
      })

      it('keeps explicit color, persona, helper and slug', async () => {
        const created = await service().create({
          name: 'Bo',
          slug: 'bo-the-builder',
          color: '#112233',
          personaMd: 'You build.',
          modelMain: model(),
          modelHelper: `${cred}:small`,
        })
        expect(created).toMatchObject({
          slug: 'bo-the-builder',
          color: '#112233',
          personaMd: 'You build.',
          modelHelper: `${cred}:small`,
        })
      })

      it.each([
        ['Ada Lovelace', 'ada-lovelace'],
        ['  Zoë & the Café!  ', 'zoe-the-cafe'],
        ['日本語', 'teammate'],
        ['---', 'teammate'],
        ['x'.repeat(60), 'x'.repeat(40)],
        [`${'a'.repeat(39)} b c`, 'a'.repeat(39)],
      ])('derives the slug for %j as %j', async (name, slug) => {
        const created = await service().create({ name, modelMain: model() })
        expect(created.slug).toBe(slug)
      })

      it('adds -2, -3 when the derived slug is taken', async () => {
        const slugs = []
        for (let i = 0; i < 3; i++) {
          slugs.push((await service().create({ name: 'Ada', modelMain: model() })).slug)
        }
        expect(slugs).toEqual(['ada', 'ada-2', 'ada-3'])
      })

      it('keeps a suffixed slug within 40 characters', async () => {
        const name = 'y'.repeat(50)
        await service().create({ name, modelMain: model() })
        const second = await service().create({ name, modelMain: model() })
        expect(second.slug).toBe(`${'y'.repeat(38)}-2`)
      })

      it('rejects an explicit slug that is taken with SlugTakenError', async () => {
        await service().create({ name: 'Ada', slug: 'ada', modelMain: model() })
        await expect(
          service().create({ name: 'Other', slug: 'ada', modelMain: model() }),
        ).rejects.toMatchObject({ name: 'SlugTakenError', slug: 'ada' })
      })

      it('treats an archived profile slug as taken', async () => {
        const first = await service().create({ name: 'Ada', modelMain: model() })
        await service().archive(first.id)
        const second = await service().create({ name: 'Ada', modelMain: model() })
        expect(second.slug).toBe('ada-2')
      })

      it('rotates default colors through the accent presets by profile count', async () => {
        const colors = []
        for (let i = 0; i < ACCENT_PRESETS.length + 1; i++) {
          colors.push((await service().create({ name: `T${i}`, modelMain: model() })).color)
        }
        expect(colors).toEqual([...ACCENT_PRESETS, ACCENT_PRESETS[0]])
      })

      it('rejects an unknown credential in modelMain or modelHelper', async () => {
        const ghost = newId('credential')
        await expect(
          service().create({ name: 'A', modelMain: `${ghost}:m` }),
        ).rejects.toBeInstanceOf(UnknownCredentialError)
        await expect(
          service().create({ name: 'A', modelMain: model(), modelHelper: `${ghost}:m` }),
        ).rejects.toMatchObject({ credentialId: ghost })
        expect(await service().list()).toEqual([])
      })
    })

    describe('list and get', () => {
      it('lists oldest first and hides archived unless asked', async () => {
        const a = await service().create({ name: 'A', modelMain: model() })
        const b = await service().create({ name: 'B', modelMain: model() })
        const c = await service().create({ name: 'C', modelMain: model() })
        await service().archive(b.id)
        expect((await service().list()).map((p) => p.id)).toEqual([a.id, c.id])
        expect((await service().list({ includeArchived: true })).map((p) => p.id)).toEqual([
          a.id,
          b.id,
          c.id,
        ])
      })

      it('get throws EntityNotFoundError for an unknown id', async () => {
        const id: ProfileId = newId('profile')
        await expect(service().get(id)).rejects.toBeInstanceOf(EntityNotFoundError)
        await expect(service().get(id)).rejects.toMatchObject({ entity: 'profile', id })
      })
    })

    describe('update', () => {
      it('applies a partial patch and leaves other fields alone', async () => {
        const created = await service().create({ name: 'Ada', modelMain: model() })
        const updated = await service().update(created.id, {
          name: 'Ada L',
          personaMd: 'New persona',
          modelHelper: `${cred}:small`,
        })
        expect(updated).toEqual({
          ...created,
          name: 'Ada L',
          personaMd: 'New persona',
          modelHelper: `${cred}:small`,
        })
        const cleared = await service().update(created.id, { modelHelper: null })
        expect(cleared.modelHelper).toBeNull()
        expect(await service().update(created.id, {})).toEqual(cleared)
      })

      it('allows re-sending the profile own slug but rejects another profile slug', async () => {
        const a = await service().create({ name: 'A', modelMain: model() })
        const b = await service().create({ name: 'B', modelMain: model() })
        expect((await service().update(a.id, { slug: 'a' })).slug).toBe('a')
        await expect(service().update(b.id, { slug: 'a' })).rejects.toBeInstanceOf(SlugTakenError)
        expect((await service().update(b.id, { slug: 'bee' })).slug).toBe('bee')
      })

      it('rejects an unknown credential in the patch', async () => {
        const created = await service().create({ name: 'Ada', modelMain: model() })
        const ghost = newId('credential')
        await expect(
          service().update(created.id, { modelMain: `${ghost}:m` }),
        ).rejects.toBeInstanceOf(UnknownCredentialError)
        expect((await service().get(created.id)).modelMain).toBe(model())
      })

      it('throws EntityNotFoundError for an unknown id', async () => {
        await expect(service().update(newId('profile'), { name: 'x' })).rejects.toBeInstanceOf(
          EntityNotFoundError,
        )
      })
    })

    describe('archive', () => {
      it('sets archivedAt, and archiving again returns the profile unchanged', async () => {
        const created = await service().create({ name: 'Ada', modelMain: model() })
        const first = await service().archive(created.id)
        expect(first.archivedAt).not.toBeNull()
        expect(Profile.safeParse(first).success).toBe(true)
        const second = await service().archive(created.id)
        expect(second).toEqual(first)
      })

      it('throws EntityNotFoundError for an unknown id', async () => {
        await expect(service().archive(newId('profile'))).rejects.toBeInstanceOf(
          EntityNotFoundError,
        )
      })
    })
  })
}
