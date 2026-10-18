import { describe, expect, it } from 'vitest'
import { executeRun } from './execute.ts'
import { NOW, setup } from './test-util.ts'

describe('executeRun: single step', () => {
  it('runs queued to succeeded, stores one assistant message and sums usage', async () => {
    const { store, runId, deps, deltas } = setup([
      { text: 'Hello there', usage: { inputTokens: 12, outputTokens: 7 } },
    ])

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'succeeded' })
    expect(store.statuses(runId)).toEqual(['running', 'succeeded'])
    const run = store.runs.get(runId)
    expect(run?.status).toBe('succeeded')
    expect(run?.usage).toEqual({ inputTokens: 12, outputTokens: 7 })
    expect(run?.startedAt?.toISOString()).toBe(NOW)
    expect(run?.endedAt?.toISOString()).toBe(NOW)
    expect(store.thread.at(-1)).toEqual({ role: 'assistant', text: 'Hello there', runId })
    expect(deltas.map((d) => d.text).join('')).toBe('Hello there')
    expect(deltas.every((d) => d.runId === runId && d.stepIdx === 0)).toBe(true)
  })

  it('persists the model step with its usage and a run.step event before finishing', async () => {
    const { store, runId, deps } = setup([
      { text: 'ok', usage: { inputTokens: 3, outputTokens: 2 } },
    ])
    await executeRun(deps)
    const rows = await store.steps(runId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      idx: 0,
      kind: 'model',
      usage: { inputTokens: 3, outputTokens: 2 },
    })
    expect(store.events.filter((e) => e.type === 'run.step')).toHaveLength(1)
  })

  it('sends persona as instructions and the thread history as messages', async () => {
    const { deps, model, store } = setup([{ text: 'ok' }])
    store.thread.unshift({ role: 'user', text: 'earlier', runId: null })
    store.thread.unshift({ role: 'assistant', text: 'earlier answer', runId: null })
    await executeRun(deps)
    const prompt = model.calls[0]?.prompt ?? []
    expect(prompt[0]).toMatchObject({ role: 'system', content: 'You are Ada.' })
    const roles = prompt.map((m) => m.role)
    expect(roles).toEqual(['system', 'assistant', 'user', 'user'])
  })

  it('does nothing for a run that is already terminal', async () => {
    const { store, runId, deps, model } = setup([{ text: 'unused' }])
    const run = store.runs.get(runId)
    if (run) run.status = 'succeeded'
    const out = await executeRun(deps)
    expect(out).toEqual({ outcome: 'skipped' })
    expect(model.calls).toHaveLength(0)
    expect(store.events).toHaveLength(0)
  })

  it('does nothing for an unknown run', async () => {
    const { deps } = setup([])
    const out = await executeRun({
      ...deps,
      runId: 'run_01HZX3K9V2M4N6P8Q0R2S4T6V9' as typeof deps.runId,
    })
    expect(out).toEqual({ outcome: 'skipped' })
  })
})
