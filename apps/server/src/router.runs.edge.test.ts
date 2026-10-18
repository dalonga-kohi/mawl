import { newId } from '@faire/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { unusedRuns } from './runs/test-util.ts'

describe('runs.start input validation', () => {
  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['newlines and tabs only', '\n\t \n'],
  ])('rejects a prompt that is %s before it reaches the service', async (_label, prompt) => {
    const start = vi.fn()
    const router = createRouter({
      version: '1',
      providers: unusedProviders,
      runs: { ...unusedRuns, start },
    })
    await expect(
      call(router.runs.start, { profileId: newId('profile'), prompt }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(start).not.toHaveBeenCalled()
  })

  it('rejects a non-integer or out-of-range budget', async () => {
    const router = createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns })
    const profileId = newId('profile')
    for (const budget of [{ maxSteps: 0 }, { maxSteps: 1.5 }, { maxTokens: -1 }]) {
      await expect(
        call(router.runs.start, { profileId, prompt: 'x', budget }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    }
  })

  it('rejects a messages limit of 0 and over 200, and a non-UTC cursor', async () => {
    const router = createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns })
    const threadId = newId('thread')
    for (const input of [
      { threadId, limit: 0 },
      { threadId, limit: 201 },
      { threadId, before: '2026-01-01T00:00:00+02:00' },
      { threadId, before: 'yesterday' },
    ]) {
      await expect(call(router.threads.messages, input)).rejects.toMatchObject({
        code: 'BAD_REQUEST',
      })
    }
  })
})
