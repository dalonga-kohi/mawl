import { tool } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'

const lookup = tool({
  description: 'Look something up',
  inputSchema: z.object({ q: z.string() }),
  execute: async ({ q }) => ({ answer: `found ${q}` }),
})

const twoStepScript = [
  {
    text: 'Checking',
    toolCalls: [{ name: 'lookup', input: { q: 'x' } }],
    usage: { inputTokens: 10, outputTokens: 4 },
  },
  { text: 'Done', usage: { inputTokens: 20, outputTokens: 6 } },
]

describe('executeRun: tool loop', () => {
  it('persists model and tool rows with contiguous idx, then the next model step', async () => {
    const { store, runId, deps, model } = setup(twoStepScript, { tools: { lookup } })

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'succeeded' })
    const rows = await store.steps(runId)
    expect(rows.map((r) => [r.idx, r.kind])).toEqual([
      [0, 'model'],
      [1, 'tool'],
      [2, 'model'],
    ])
    expect(rows[1]?.messages[0]).toMatchObject({ role: 'tool' })
    expect(rows[1]?.usage).toBeNull()
    expect(store.events.filter((e) => e.type === 'run.step')).toHaveLength(3)
    expect(store.runs.get(runId)?.usage).toEqual({ inputTokens: 30, outputTokens: 10 })
    // Step 2 saw the tool result.
    const second = model.calls[1]?.prompt ?? []
    expect(second.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool'])
    expect(store.thread.at(-1)?.text).toBe('Checking\n\nDone')
  })

  it('writes the model row and its tool row in one append', async () => {
    const { store, deps } = setup(twoStepScript, { tools: { lookup } })
    const append = vi.spyOn(store, 'appendStep')
    await executeRun(deps)
    expect(append).toHaveBeenCalledTimes(2)
    expect(append.mock.calls[0]?.[1]).toMatchObject({ idx: 0 })
    expect(append.mock.calls[0]?.[1].toolMessages).toHaveLength(1)
    expect(append.mock.calls[1]?.[1]).toMatchObject({ idx: 2, toolMessages: null })
  })

  it('does not pass tools to a model that cannot use them', async () => {
    const { deps, model } = setup([{ text: 'plain' }], {
      tools: { lookup },
      supportsTools: false,
    })
    await executeRun(deps)
    expect(model.calls[0]?.tools ?? []).toHaveLength(0)
  })

  it('passes tools to a model that supports them', async () => {
    const { deps, model } = setup([{ text: 'plain' }], { tools: { lookup } })
    await executeRun(deps)
    expect(model.calls[0]?.tools).toHaveLength(1)
  })

  it('records a tool error as a result and lets the model continue', async () => {
    const broken = tool({
      description: 'always fails',
      inputSchema: z.object({}),
      execute: async (): Promise<string> => {
        throw new Error('disk exploded with secret hunter2')
      },
    })
    const { store, runId, deps } = setup(
      [{ toolCalls: [{ name: 'broken', input: {} }] }, { text: 'recovered' }],
      { tools: { broken } },
    )
    const out = await executeRun(deps)
    expect(out).toEqual({ outcome: 'succeeded' })
    expect((await store.steps(runId)).map((r) => r.kind)).toEqual(['model', 'tool', 'model'])
  })
})
