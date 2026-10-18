import { tool } from 'ai'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'

const noop = tool({
  description: 'does nothing',
  inputSchema: z.object({}),
  execute: async () => 'ok',
})
const call = { toolCalls: [{ name: 'noop', input: {} }] }

afterEach(() => {
  vi.useRealTimers()
})

describe('executeRun: budgets', () => {
  it('fails budget_steps after the step cap, with the capped steps persisted', async () => {
    const { store, runId, deps, model } = setup([call, call, { text: 'never' }], {
      tools: { noop },
    })
    const run = store.runs.get(runId)
    if (run) run.budget = { maxSteps: 2 }

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'failed', error: 'budget_steps' })
    expect(model.calls).toHaveLength(2)
    expect((await store.steps(runId)).map((s) => s.kind)).toEqual([
      'model',
      'tool',
      'model',
      'tool',
    ])
  })

  it('uses the engine default when the run sets none, and the run value when it does', async () => {
    const a = setup([call, call, { text: 'x' }], {
      tools: { noop },
      defaults: { maxSteps: 1, maxTokens: 1_000_000, maxWallClockMs: 60_000 },
    })
    expect(await executeRun(a.deps)).toEqual({ outcome: 'failed', error: 'budget_steps' })
    expect(a.model.calls).toHaveLength(1)

    const b = setup([call, call, { text: 'x' }], {
      tools: { noop },
      defaults: { maxSteps: 1, maxTokens: 1_000_000, maxWallClockMs: 60_000 },
    })
    const run = b.store.runs.get(b.runId)
    if (run) run.budget = { maxSteps: 5 }
    expect(await executeRun(b.deps)).toEqual({ outcome: 'succeeded' })
  })

  it('has defaults of 20 steps, 200k tokens and 15 minutes', async () => {
    const { DEFAULT_RUN_BUDGET } = await import('./types.ts')
    expect(DEFAULT_RUN_BUDGET).toEqual({
      maxSteps: 20,
      maxTokens: 200_000,
      maxWallClockMs: 15 * 60_000,
    })
  })

  it('persists the step that crossed the token cap, then fails budget_tokens', async () => {
    const { store, runId, deps, model } = setup(
      [{ ...call, usage: { inputTokens: 90, outputTokens: 20 } }, { text: 'never' }],
      { tools: { noop } },
    )
    const run = store.runs.get(runId)
    if (run) run.budget = { maxTokens: 100 }

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'failed', error: 'budget_tokens' })
    expect(model.calls).toHaveLength(1)
    expect(await store.steps(runId)).toHaveLength(2)
    expect(store.runs.get(runId)?.usage).toEqual({ inputTokens: 90, outputTokens: 20 })
  })

  it('lets a final answer succeed even when it crosses the token cap', async () => {
    const { store, runId, deps } = setup([
      { text: 'big', usage: { inputTokens: 500, outputTokens: 5 } },
    ])
    const run = store.runs.get(runId)
    if (run) run.budget = { maxTokens: 100 }
    expect(await executeRun(deps)).toEqual({ outcome: 'succeeded' })
  })

  it('fails budget_wall_clock before a step when the clock says time is up', async () => {
    const { store, runId, deps, model, clock } = setup([{ text: 'never' }])
    const run = store.runs.get(runId)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.status = 'running'
      run.startedAt = new Date(clock.now().getTime() - 61_000)
    }
    const out = await executeRun(deps)
    expect(out).toEqual({ outcome: 'failed', error: 'budget_wall_clock' })
    expect(model.calls).toHaveLength(0)
  })

  it('checks the wall clock between steps', async () => {
    const slow = tool({
      description: 'takes a while',
      inputSchema: z.object({}),
      execute: async () => {
        h.clock.advance(20 * 60_000)
        return 'ok'
      },
    })
    const h = setup([{ toolCalls: [{ name: 'slow', input: {} }] }, { text: 'never' }], {
      tools: { slow },
    })
    const out = await executeRun(h.deps)
    expect(out).toEqual({ outcome: 'failed', error: 'budget_wall_clock' })
    expect(h.model.calls).toHaveLength(1)
  })

  it('aborts a step that is still streaming when the wall clock runs out', async () => {
    vi.useFakeTimers()
    const { store, runId, deps } = setup([{ text: 'a long slow answer for the model' }], {})
    // Slow stream: a second between 3-character chunks.
    const { fakeModel } = await import('@faire/testkit')
    const slowModel = fakeModel([{ text: 'a long slow answer for the model' }], {
      chunkSize: 3,
      chunkDelayMs: 1000,
    })
    const run = store.runs.get(runId)
    if (run) run.budget = { maxWallClockMs: 2500 }

    const done = executeRun({ ...deps, resolveModel: async () => slowModel })
    await vi.advanceTimersByTimeAsync(5000)

    expect(await done).toEqual({ outcome: 'failed', error: 'budget_wall_clock' })
    expect(await store.steps(runId)).toHaveLength(0)
    expect(store.runs.get(runId)?.status).toBe('failed')
  })
})
