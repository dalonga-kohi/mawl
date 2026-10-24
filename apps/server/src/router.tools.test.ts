import { newId, type Run, type SearchStatus } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { EntityNotFoundError, RunConflictError } from './runs/errors.ts'
import type { RunService } from './runs/service.ts'
import { unusedRuns } from './runs/test-util.ts'
import type { SearchService } from './search/service.ts'

const run = {
  id: newId('run'),
  profileId: newId('profile'),
  threadId: newId('thread'),
  trigger: 'user',
  status: 'running',
  budget: {},
  usage: { inputTokens: 0, outputTokens: 0 },
  segmentNo: 0,
  activeMs: 0,
  startedAt: null,
  endedAt: null,
  error: null,
} satisfies Run

const configured: SearchStatus = {
  provider: 'brave',
  configured: true,
  updatedAt: '2026-01-02T03:04:05.000Z',
}

const unusedSearch: SearchService = {
  status: () => Promise.reject(new Error('search.status not stubbed')),
  setKey: () => Promise.reject(new Error('search.setKey not stubbed')),
  clearKey: () => Promise.reject(new Error('search.clearKey not stubbed')),
  provider: () => Promise.reject(new Error('search.provider not stubbed')),
}

function routerWith(runs: Partial<RunService> = {}, search?: Partial<SearchService>) {
  return createRouter({
    version: '1',
    providers: unusedProviders,
    runs: { ...unusedRuns, ...runs },
    ...(search ? { search: { ...unusedSearch, ...search } } : {}),
  })
}

describe('runs.reply', () => {
  it('hands the trimmed answer to the service and returns the run', async () => {
    const reply = vi.fn(async () => run)
    const out = await call(routerWith({ reply }).runs.reply, { id: run.id, answer: '  Green ' })
    expect(reply).toHaveBeenCalledWith(run.id, 'Green')
    expect(out).toEqual(run)
  })

  it('maps a run that is not waiting to typed CONFLICT', async () => {
    const reply = async () => {
      throw new RunConflictError('running', 'running')
    }
    await expect(
      call(routerWith({ reply }).runs.reply, { id: run.id, answer: 'x' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      data: { from: 'running', to: 'running' },
    })
  })

  it('maps a missing run to typed NOT_FOUND', async () => {
    const reply = async () => {
      throw new EntityNotFoundError('run', run.id)
    }
    await expect(
      call(routerWith({ reply }).runs.reply, { id: run.id, answer: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 })
  })

  it('rejects a blank answer before the service runs', async () => {
    const reply = vi.fn(async () => run)
    await expect(
      call(routerWith({ reply }).runs.reply, { id: run.id, answer: '   ' }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(reply).not.toHaveBeenCalled()
  })
})

describe('search procedures', () => {
  it('status, setKey and clearKey go to the service', async () => {
    const setKey = vi.fn(async () => configured)
    const router = routerWith(
      {},
      {
        status: async () => configured,
        setKey,
        clearKey: async () => ({ provider: 'brave', configured: false, updatedAt: null }),
      },
    )
    expect(await call(router.search.status, undefined)).toEqual(configured)
    expect(await call(router.search.setKey, { provider: 'brave', apiKey: ' k ' })).toEqual(
      configured,
    )
    expect(setKey).toHaveBeenCalledWith({ provider: 'brave', apiKey: 'k' })
    expect((await call(router.search.clearKey, undefined)).configured).toBe(false)
  })

  it('refuses to answer a status that carries anything more (strict output)', async () => {
    const leaky = { ...configured, apiKey: 'BSA-x' } as unknown as SearchStatus
    const router = routerWith({}, { status: async () => leaky })
    await expect(call(router.search.status, undefined)).rejects.toThrow()
  })

  it('stays a 501 stub without a search service', async () => {
    await expect(call(routerWith().search.status, undefined)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    })
  })
})
