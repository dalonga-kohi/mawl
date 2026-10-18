import { fakeModel } from '@faire/testkit'
import { tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'
import { ABORT_SHUTDOWN } from './types.ts'

const noop = tool({
  description: 'does nothing',
  inputSchema: z.object({}),
  execute: async () => 'ok',
})
const call = (text?: string) => ({
  ...(text ? { text } : {}),
  toolCalls: [{ name: 'noop', input: {} }],
})

describe('executeRun: cancel, pause, shutdown', () => {
  it('stops without writing when the run is cancelled mid-stream', async () => {
    const abort = new AbortController()
    const h = setup([{ text: 'a fairly long answer' }], { signal: abort.signal })
    let first = true
    h.deps.onDelta = () => {
      if (!first) return
      first = false
      // What runs.cancel does: CAS to cancelled, then abort the controller.
      const run = h.store.runs.get(h.runId)
      if (run) run.status = 'cancelled'
      abort.abort('cancel')
    }

    const out = await executeRun(h.deps)

    expect(out).toEqual({ outcome: 'superseded' })
    expect(h.store.runs.get(h.runId)?.status).toBe('cancelled')
    expect(h.store.statuses(h.runId)).toEqual(['running'])
    expect(h.store.thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
    expect(await h.store.steps(h.runId)).toHaveLength(0)
  })

  it('does not overwrite a cancel that lands right before the finish', async () => {
    const h = setup([{ text: 'done' }])
    const succeed = h.store.succeed.bind(h.store)
    vi.spyOn(h.store, 'succeed').mockImplementation(async (id, r) => {
      const run = h.store.runs.get(id)
      if (run) run.status = 'cancelled'
      return succeed(id, r)
    })
    const out = await executeRun(h.deps)
    expect(out).toEqual({ outcome: 'superseded' })
    expect(h.store.runs.get(h.runId)?.status).toBe('cancelled')
    expect(h.store.thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })

  it('stops between steps when another actor paused the run', async () => {
    const h = setup([call(), { text: 'never' }], {
      tools: {
        noop: tool({
          description: 'pauses the run as a side effect',
          inputSchema: z.object({}),
          execute: async () => {
            const run = h.store.runs.get(h.runId)
            if (run) run.status = 'paused'
            return 'ok'
          },
        }),
      },
    })
    const out = await executeRun(h.deps)
    expect(out).toEqual({ outcome: 'superseded' })
    expect(h.model.calls).toHaveLength(1)
    expect(h.store.runs.get(h.runId)?.status).toBe('paused')
  })

  it('stops when queued to running is lost to a cancel', async () => {
    const h = setup([{ text: 'unused' }])
    vi.spyOn(h.store, 'transition').mockResolvedValueOnce(false)
    expect(await executeRun(h.deps)).toEqual({ outcome: 'superseded' })
    expect(h.model.calls).toHaveLength(0)
  })

  it('leaves the run running and resumable on shutdown mid-stream', async () => {
    const abort = new AbortController()
    const h = setup([{ text: 'a fairly long answer' }], { signal: abort.signal })
    h.deps.onDelta = () => abort.abort(ABORT_SHUTDOWN)

    const out = await executeRun(h.deps)

    expect(out).toEqual({ outcome: 'interrupted' })
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    expect(h.store.statuses(h.runId)).toEqual(['running'])
    expect(await h.store.steps(h.runId)).toHaveLength(0)
  })

  it('leaves the run running when the signal was already aborted for shutdown', async () => {
    const abort = new AbortController()
    abort.abort(ABORT_SHUTDOWN)
    const h = setup([{ text: 'unused' }], { signal: abort.signal })
    expect(await executeRun(h.deps)).toEqual({ outcome: 'interrupted' })
    expect(h.model.calls).toHaveLength(0)
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
  })

  it.each([
    'succeeded',
    'failed',
    'cancelled',
    'paused',
    'waiting_user',
    'waiting_approval',
  ] as const)('skips a run that is %s', async (status) => {
    const h = setup([{ text: 'unused' }])
    const run = h.store.runs.get(h.runId)
    if (run) run.status = status
    expect(await executeRun(h.deps)).toEqual({ outcome: 'skipped' })
    expect(h.model.calls).toHaveLength(0)
  })
})

describe('executeRun: crash and resume', () => {
  it('resumes from the last persisted step and calls only the missing step', async () => {
    const h = setup([call('one'), call('two'), { text: 'three' }], { tools: { noop } })

    // Crash while saving step 3: the store dies after two steps are safely written.
    const append = h.store.appendStep.bind(h.store)
    let appends = 0
    vi.spyOn(h.store, 'appendStep').mockImplementation(async (...args) => {
      if (++appends === 3) throw new Error('process died')
      return append(...args)
    })
    await expect(executeRun(h.deps)).rejects.toThrow('process died')
    expect((await h.store.steps(h.runId)).map((s) => s.idx)).toEqual([0, 1, 2, 3])
    expect(h.store.runs.get(h.runId)?.status).toBe('running')

    // A new job picks the run up with a fresh model that holds only the remaining turn.
    vi.restoreAllMocks()
    const resumed = fakeModel([{ text: 'three' }])
    const out = await executeRun({ ...h.deps, resolveModel: async () => resumed, tools: { noop } })

    expect(out).toEqual({ outcome: 'succeeded' })
    expect(resumed.calls).toHaveLength(1)
    expect((resumed.calls[0]?.prompt ?? []).map((m) => m.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
    ])
    const rows = await h.store.steps(h.runId)
    expect(rows.map((s) => s.idx)).toEqual([0, 1, 2, 3, 4])
    expect(h.store.statuses(h.runId)).toEqual(['running', 'succeeded'])
    expect(h.store.thread.at(-1)?.text).toBe('one\n\ntwo\n\nthree')
  })

  it('finishes without calling the model when only the finish was lost', async () => {
    const h = setup([{ text: 'answer' }])
    const succeed = vi.spyOn(h.store, 'succeed').mockRejectedValueOnce(new Error('died'))
    await expect(executeRun(h.deps)).rejects.toThrow('died')
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    succeed.mockRestore()

    const again = fakeModel([{ text: 'must not be called' }])
    const out = await executeRun({ ...h.deps, resolveModel: async () => again })
    expect(out).toEqual({ outcome: 'succeeded' })
    expect(again.calls).toHaveLength(0)
    expect(h.store.thread.at(-1)?.text).toBe('answer')
  })

  it('ends a duplicate execution quietly when the step already exists', async () => {
    const h = setup([{ text: 'x' }])
    vi.spyOn(h.store, 'appendStep').mockResolvedValue(false)
    const out = await executeRun(h.deps)
    expect(out).toEqual({ outcome: 'interrupted' })
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    expect(h.store.thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })
})
