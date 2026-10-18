import { tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'
import { ABORT_SHUTDOWN } from './types.ts'

const hour = 60 * 60_000
const noop = tool({
  description: 'does nothing',
  inputSchema: z.object({}),
  execute: async () => 'ok',
})
const call = { toolCalls: [{ name: 'noop', input: {} }] }

describe('executeRun: the wall-clock budget counts active time only', () => {
  it('lets a run that sat paused for longer than the cap resume and finish', async () => {
    const h = setup([{ text: 'back again' }])
    const run = h.store.runs.get(h.runId)
    const startedAt = new Date(h.clock.now().getTime() - hour)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.startedAt = startedAt
      run.activeMs = 10_000
    }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'succeeded' })
    // Resuming does not restart the run's original start time.
    expect(h.store.runs.get(h.runId)?.startedAt).toEqual(startedAt)
  })

  it('does not count the gap of a crash and restart', async () => {
    const h = setup([{ text: 'recovered' }])
    const run = h.store.runs.get(h.runId)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.status = 'running'
      run.startedAt = new Date(h.clock.now().getTime() - hour)
      run.activeMs = 1_000
    }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'succeeded' })
  })

  it('adds the time each step took to the run and fails once the active total is spent', async () => {
    const slow = tool({
      description: 'takes two seconds',
      inputSchema: z.object({}),
      execute: async () => {
        h.clock.advance(2_000)
        return 'ok'
      },
    })
    const h = setup([{ toolCalls: [{ name: 'slow', input: {} }] }, { text: 'never' }], {
      tools: { slow },
    })
    const run = h.store.runs.get(h.runId)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.activeMs = 59_000
    }

    expect(await executeRun(h.deps)).toEqual({ outcome: 'failed', error: 'budget_wall_clock' })
    expect(h.model.calls).toHaveLength(1)
    expect(h.store.runs.get(h.runId)?.activeMs).toBe(61_000)
  })

  it('records the time of the last step when the run succeeds', async () => {
    const h = setup([{ text: 'x' }])
    const t = h.clock.now().getTime()
    h.deps.onDelta = () => h.clock.advance(300)
    await executeRun(h.deps)
    expect(h.store.runs.get(h.runId)?.activeMs).toBeGreaterThan(0)
    expect(h.clock.now().getTime()).toBeGreaterThan(t)
  })
})

describe('executeRun: a step is only written while the run is running', () => {
  it('stops quietly, with no step event, when cancel lands during the step', async () => {
    const cancelling = tool({
      description: 'cancels the run as a side effect',
      inputSchema: z.object({}),
      execute: async () => {
        const run = h.store.runs.get(h.runId)
        if (run) run.status = 'cancelled'
        return 'ok'
      },
    })
    const h = setup([{ toolCalls: [{ name: 'cancelling', input: {} }] }, { text: 'never' }], {
      tools: { cancelling },
    })
    const out = await executeRun(h.deps)
    expect(out).toEqual({ outcome: 'superseded' })
    expect(await h.store.steps(h.runId)).toHaveLength(0)
    expect(h.store.events.filter((e) => e.type === 'run.step')).toHaveLength(0)
    expect(h.model.calls).toHaveLength(1)
  })

  it('treats a not_running answer from the store as superseded', async () => {
    const h = setup([{ text: 'x' }])
    vi.spyOn(h.store, 'appendStep').mockResolvedValue('not_running')
    expect(await executeRun(h.deps)).toEqual({ outcome: 'superseded' })
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
  })
})

describe('executeRun: model resolution errors', () => {
  it('rethrows an infrastructure error so the job retries, leaving the run running', async () => {
    const h = setup([{ text: 'unused' }], {
      resolveModel: async () => {
        throw new Error('connection terminated')
      },
    })
    await expect(executeRun(h.deps)).rejects.toThrow('connection terminated')
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    expect(h.store.runs.get(h.runId)?.error).toBeNull()
  })
})

describe('executeRun: shutdown', () => {
  it('leaves the run running with the steps it already persisted and no reply', async () => {
    const abort = new AbortController()
    const h = setup([{ ...call, text: 'one' }, { text: 'a long second answer' }], {
      tools: { noop },
      signal: abort.signal,
    })
    h.deps.onDelta = ({ stepIdx }) => {
      if (stepIdx === 2) abort.abort(ABORT_SHUTDOWN)
    }

    const out = await executeRun(h.deps)

    expect(out).toEqual({ outcome: 'interrupted' })
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    expect((await h.store.steps(h.runId)).map((s) => s.idx)).toEqual([0, 1])
    expect(h.store.statuses(h.runId)).toEqual(['running'])
    expect(h.store.thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })
})
