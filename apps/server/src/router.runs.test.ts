import { newId, type Run } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { EntityNotFoundError, RunConflictError } from './runs/errors.ts'
import type { RunService } from './runs/service.ts'
import { unusedRuns } from './runs/test-util.ts'

const run = {
  id: newId('run'),
  profileId: newId('profile'),
  threadId: newId('thread'),
  trigger: 'user',
  status: 'queued',
  budget: {},
  usage: { inputTokens: 0, outputTokens: 0 },
  segmentNo: 0,
  activeMs: 0,
  startedAt: null,
  endedAt: null,
  error: null,
} satisfies Run

function routerWith(over: Partial<RunService>) {
  return createRouter({
    version: '1',
    providers: unusedProviders,
    runs: { ...unusedRuns, ...over },
  })
}

describe('runs procedures', () => {
  it('start passes the input to the service and returns the run', async () => {
    const start = vi.fn(async () => run)
    const router = routerWith({ start })
    const input = { profileId: run.profileId, prompt: 'hi', budget: { maxSteps: 2 } }
    expect(await call(router.runs.start, input)).toEqual(run)
    expect(start).toHaveBeenCalledWith(expect.objectContaining(input))
  })

  it.each([
    ['profile', 'start'],
    ['run', 'get'],
    ['run', 'cancel'],
    ['run', 'pause'],
    ['run', 'resume'],
  ] as const)('maps a missing %s to typed NOT_FOUND on runs.%s', async (entity, name) => {
    const id = newId(entity)
    const fail = async () => {
      throw new EntityNotFoundError(entity, id)
    }
    const router = routerWith({ start: fail, get: fail, cancel: fail, pause: fail, resume: fail })
    const input = name === 'start' ? { profileId: id, prompt: 'x' } : { id }
    await expect(call(router.runs[name] as never, input as never)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      data: { entity, id },
    })
  })

  it.each(['cancel', 'pause', 'resume'] as const)(
    'maps a state conflict to typed CONFLICT on runs.%s',
    async (name) => {
      const fail = async () => {
        throw new RunConflictError('succeeded', 'cancelled')
      }
      const router = routerWith({ cancel: fail, pause: fail, resume: fail })
      await expect(call(router.runs[name], { id: run.id })).rejects.toMatchObject({
        code: 'CONFLICT',
        status: 409,
        data: { from: 'succeeded', to: 'cancelled' },
      })
    },
  )

  it('lets unexpected errors through untouched', async () => {
    const router = routerWith({
      get: async () => {
        throw new Error('db down')
      },
    })
    await expect(call(router.runs.get, { id: run.id })).rejects.toThrow('db down')
  })
})

describe('threads procedures', () => {
  it('list and messages call the service and map NOT_FOUND', async () => {
    const profileId = newId('profile')
    const threadId = newId('thread')
    const listThreads = vi.fn(async () => [])
    const threadMessages = vi.fn(async () => [])
    const router = routerWith({ listThreads, threadMessages })
    expect(await call(router.threads.list, { profileId })).toEqual([])
    expect(await call(router.threads.messages, { threadId, limit: 5 })).toEqual([])
    expect(listThreads).toHaveBeenCalledWith(profileId)
    expect(threadMessages).toHaveBeenCalledWith(expect.objectContaining({ threadId, limit: 5 }))

    const missing = routerWith({
      listThreads: async () => {
        throw new EntityNotFoundError('profile', profileId)
      },
      threadMessages: async () => {
        throw new EntityNotFoundError('thread', threadId)
      },
    })
    await expect(call(missing.threads.list, { profileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      data: { entity: 'profile', id: profileId },
    })
    await expect(call(missing.threads.messages, { threadId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      data: { entity: 'thread', id: threadId },
    })
  })
})
