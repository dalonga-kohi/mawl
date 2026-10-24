import { describe, expect, it } from 'vitest'
import { executeRun } from './execute.ts'
import { setup, testTools } from './test-util.ts'

const noop = () => 'ok'
const toolStep = (inputTokens: number, outputTokens: number) => ({
  toolCalls: [{ name: 'noop', input: {} }],
  usage: { inputTokens, outputTokens },
})

describe('executeRun: budget boundaries', () => {
  it('fails budget_tokens when usage equals the cap exactly', async () => {
    const h = setup([toolStep(60, 40), { text: 'never' }], { tools: testTools({ noop }) })
    const run = h.store.runs.get(h.runId)
    if (run) run.budget = { maxTokens: 100 }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'failed', error: 'budget_tokens' })
    expect(h.model.calls).toHaveLength(1)
  })

  it('keeps going when usage is one token under the cap', async () => {
    const h = setup([toolStep(60, 39), { text: 'fine' }], { tools: testTools({ noop }) })
    const run = h.store.runs.get(h.runId)
    if (run) run.budget = { maxTokens: 100 }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'succeeded' })
    expect(h.model.calls).toHaveLength(2)
  })

  it('fails budget_wall_clock when exactly the whole allowance has elapsed', async () => {
    const h = setup([{ text: 'never' }])
    const run = h.store.runs.get(h.runId)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.status = 'running'
      run.activeMs = 60_000
    }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'failed', error: 'budget_wall_clock' })
    expect(h.model.calls).toHaveLength(0)
  })

  it('still runs when one millisecond of the allowance is left', async () => {
    const h = setup([{ text: 'in time' }])
    const run = h.store.runs.get(h.runId)
    if (run) {
      run.budget = { maxWallClockMs: 60_000 }
      run.status = 'running'
      run.activeMs = 59_999
    }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'succeeded' })
  })

  it('a run budget of one step lets a plain answer succeed and stops a tool loop', async () => {
    const plain = setup([{ text: 'one and done' }])
    const p = plain.store.runs.get(plain.runId)
    if (p) p.budget = { maxSteps: 1 }
    expect(await executeRun(plain.deps)).toEqual({ outcome: 'succeeded' })

    const loop = setup([toolStep(1, 1), { text: 'never' }], { tools: testTools({ noop }) })
    const l = loop.store.runs.get(loop.runId)
    if (l) l.budget = { maxSteps: 1 }
    expect(await executeRun(loop.deps)).toEqual({ outcome: 'failed', error: 'budget_steps' })
  })

  it('a run budget smaller than the engine defaults wins on every axis', async () => {
    const h = setup([toolStep(5, 5), toolStep(5, 5), { text: 'never' }], {
      tools: testTools({ noop }),
      defaults: { maxSteps: 20, maxTokens: 200_000, maxWallClockMs: 900_000 },
    })
    const run = h.store.runs.get(h.runId)
    if (run) run.budget = { maxSteps: 20, maxTokens: 15 }
    expect(await executeRun(h.deps)).toEqual({ outcome: 'failed', error: 'budget_tokens' })
    expect(h.model.calls).toHaveLength(2)
  })
})
