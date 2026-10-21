import { newId, type Profile } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { SlugTakenError, UnknownCredentialError } from './profiles/errors.ts'
import type { ProfileService } from './profiles/service.ts'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { EntityNotFoundError } from './runs/errors.ts'
import { unusedRuns } from './runs/test-util.ts'

const cred = newId('credential')
const profile: Profile = {
  id: newId('profile'),
  name: 'Ada',
  slug: 'ada',
  color: '#3D8BFD',
  personaMd: '',
  modelMain: `${cred}:fake-echo`,
  modelHelper: null,
  heartbeatCron: null,
  createdAt: '2026-01-02T03:04:05.000Z',
  archivedAt: null,
}

const reject = (err: Error) => async () => {
  throw err
}

function routerWith(over: Partial<ProfileService>) {
  const profiles: ProfileService = {
    list: async () => [profile],
    get: async () => profile,
    create: async () => profile,
    update: async () => profile,
    archive: async () => profile,
    ...over,
  }
  return createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns, profiles })
}

describe('profiles procedures', () => {
  it('list passes includeArchived and returns the service result', async () => {
    const list = vi.fn(async () => [profile])
    const router = routerWith({ list })
    expect(await call(router.profiles.list, { includeArchived: true })).toEqual([profile])
    expect(list).toHaveBeenCalledWith({ includeArchived: true })
    expect(await call(router.profiles.list, undefined)).toEqual([profile])
  })

  it('create and update hand the input to the service', async () => {
    const create = vi.fn(async () => profile)
    const update = vi.fn(async () => profile)
    const router = routerWith({ create, update })
    const input = { name: 'Ada', modelMain: profile.modelMain }
    expect(await call(router.profiles.create, input)).toEqual(profile)
    expect(create).toHaveBeenCalledWith(input)
    expect(await call(router.profiles.update, { id: profile.id, patch: { name: 'B' } })).toEqual(
      profile,
    )
    expect(update).toHaveBeenCalledWith(profile.id, { name: 'B' })
  })

  it.each(['get', 'archive', 'update'] as const)(
    'maps a missing profile to NOT_FOUND on %s',
    async (name) => {
      const fail = reject(new EntityNotFoundError('profile', profile.id))
      const router = routerWith({ get: fail, archive: fail, update: fail })
      const input = name === 'update' ? { id: profile.id, patch: {} } : { id: profile.id }
      await expect(call(router.profiles[name] as never, input as never)).rejects.toMatchObject({
        code: 'NOT_FOUND',
        status: 404,
        data: { entity: 'profile', id: profile.id },
      })
    },
  )

  it.each(['create', 'update'] as const)('maps a taken slug to SLUG_TAKEN on %s', async (name) => {
    const fail = reject(new SlugTakenError('ada'))
    const router = routerWith({ create: fail, update: fail })
    const input =
      name === 'create'
        ? { name: 'Ada', modelMain: profile.modelMain }
        : { id: profile.id, patch: { slug: 'ada' } }
    await expect(call(router.profiles[name] as never, input as never)).rejects.toMatchObject({
      code: 'SLUG_TAKEN',
      status: 409,
      data: { slug: 'ada' },
    })
  })

  it.each(['create', 'update'] as const)(
    'maps an unknown credential to UNKNOWN_CREDENTIAL on %s',
    async (name) => {
      const fail = reject(new UnknownCredentialError(cred))
      const router = routerWith({ create: fail, update: fail })
      const input =
        name === 'create'
          ? { name: 'Ada', modelMain: profile.modelMain }
          : { id: profile.id, patch: { modelMain: profile.modelMain } }
      await expect(call(router.profiles[name] as never, input as never)).rejects.toMatchObject({
        code: 'UNKNOWN_CREDENTIAL',
        status: 422,
        data: { credentialId: cred },
      })
    },
  )
})
