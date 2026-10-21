import type { UserProfile } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { unusedRuns } from './runs/test-util.ts'
import type { UserService } from './user/service.ts'

const saved: UserProfile = { name: 'Sam', personalContext: 'I run a bakery.' }

function routerWith(over: Partial<UserService> = {}) {
  const user: UserService = {
    get: async () => saved,
    update: async (input) => input,
    ...over,
  }
  return createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns, user })
}

describe('user procedures', () => {
  it('get returns the stored profile', async () => {
    expect(await call(routerWith().user.get, undefined)).toEqual(saved)
  })

  it('update hands the trimmed, whole profile to the service and returns what it saved', async () => {
    const update = vi.fn(async (input: UserProfile) => input)
    const router = routerWith({ update })
    const out = await call(router.user.update, { name: '  Sam ', personalContext: ' hi ' })
    expect(update).toHaveBeenCalledWith({ name: 'Sam', personalContext: ' hi ' })
    expect(out).toEqual({ name: 'Sam', personalContext: ' hi ' })
  })

  it.each([
    ['a name over 80 characters', { name: 'x'.repeat(81), personalContext: '' }],
    ['a context over 2000 characters', { name: '', personalContext: 'x'.repeat(2001) }],
    ['a missing field', { name: 'Sam' }],
    ['an extra key', { name: 'Sam', personalContext: '', secret: 'sk-x' }],
  ])('rejects %s before the service runs', async (_label, input) => {
    const update = vi.fn(async (i: UserProfile) => i)
    await expect(call(routerWith({ update }).user.update, input as never)).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(update).not.toHaveBeenCalled()
  })

  it('refuses to answer with anything beyond name and context (strict output)', async () => {
    const leaky = { ...saved, updatedAt: new Date(), id: 1 } as unknown as UserProfile
    await expect(call(routerWith({ get: async () => leaky }).user.get, undefined)).rejects.toThrow()
  })

  it('stays a 501 stub without a user service', async () => {
    const router = createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns })
    await expect(call(router.user.get, undefined)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    })
  })
})
