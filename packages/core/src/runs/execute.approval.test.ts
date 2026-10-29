import { fakeModel } from '@mawl/testkit'
import type { ModelMessage } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineTool } from '../tools/define.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { ToolGate } from '../tools/types.ts'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'

/** Asks for every write, allows the rest: enough policy to exercise the engine. */
const askForWrites: ToolGate = {
  check: async (req) =>
    req.actionClass === 'write_local'
      ? {
          decision: 'park',
          reason: 'Default for write_local.',
          audit: { level: 'ask', source: 'global' },
        }
      : { decision: 'allow', audit: { level: 'auto', source: 'global' } },
}

function tools(write: (input: { path: string }) => string) {
  const writeTool = defineTool({
    name: 'write',
    description: 'w',
    inputSchema: z.strictObject({ path: z.string() }),
    actionClass: 'write_local',
    run: async (input) => ({ kind: 'ok', text: write(input) }),
  })
  const readTool = defineTool({
    name: 'read',
    description: 'r',
    inputSchema: z.strictObject({}),
    actionClass: 'read',
    run: async () => ({ kind: 'ok', text: 'read it' }),
  })
  return createToolRegistry({ tools: [writeTool, readTool], gate: askForWrites })
}

function toolResultText(messages: ModelMessage[]): string[] {
  return messages.flatMap((m) =>
    m.role === 'tool' && typeof m.content !== 'string'
      ? m.content.flatMap((p) =>
          p.type === 'tool-result' && (p.output.type === 'text' || p.output.type === 'error-text')
            ? [p.output.value]
            : [],
        )
      : [],
  )
}

const writeCall = { toolCalls: [{ name: 'write', input: { path: 'notes.md' } }] }

describe('executeRun: an ask parks the run for approval', () => {
  it('moves the run to waiting_approval, keeps the call and releases the worker', async () => {
    const write = vi.fn(() => 'wrote')
    const h = setup([writeCall], { tools: tools(write) })
    expect(await executeRun(h.deps)).toEqual({ outcome: 'waiting' })
    expect(write).not.toHaveBeenCalled()
    expect(h.store.runs.get(h.runId)?.status).toBe('waiting_approval')
    expect(h.store.waits.get(h.runId)).toMatchObject({
      kind: 'approval',
      stepIdx: 0,
      toolCallId: 'call_1',
      approval: { tool: 'write', argsText: '{"path":"notes.md"}' },
    })
    expect(h.store.statuses(h.runId)).toEqual(['running', 'waiting_approval'])
    // Waiting never times out into failed: a job that finds it waiting does nothing.
    expect(await executeRun(h.deps)).toEqual({ outcome: 'skipped' })
  })

  it('runs the approved call once with the stored arguments and continues', async () => {
    const write = vi.fn((input: { path: string }) => `wrote ${input.path}`)
    const h = setup([writeCall], { tools: tools(write) })
    await executeRun(h.deps)
    expect(await h.store.decide(h.runId, 'approve')).toBe(true)

    const resumed = fakeModel([{ text: 'done' }])
    const deps = { ...h.deps, resolveModel: async () => ({ model: resumed }) }
    expect(await executeRun(deps)).toEqual({ outcome: 'succeeded' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ path: 'notes.md' })
    const rows = await h.store.steps(h.runId)
    expect(rows.map((s) => s.kind)).toEqual(['model', 'tool', 'model'])
    expect(toolResultText(rows[1]?.messages ?? [])[0]).toContain('wrote notes.md')
    expect(h.store.statuses(h.runId)).toEqual([
      'running',
      'waiting_approval',
      'running',
      'succeeded',
    ])
  })

  it('returns a denial to the model and the run continues', async () => {
    const write = vi.fn(() => 'wrote')
    const h = setup([writeCall], { tools: tools(write) })
    await executeRun(h.deps)
    await h.store.decide(h.runId, 'denied')
    const resumed = fakeModel([{ text: 'ok, I will not write it' }])
    expect(await executeRun({ ...h.deps, resolveModel: async () => ({ model: resumed }) })).toEqual(
      { outcome: 'succeeded' },
    )
    expect(write).not.toHaveBeenCalled()
    const rows = await h.store.steps(h.runId)
    expect(toolResultText(rows[1]?.messages ?? [])[0]).toMatch(/owner denied/)
  })

  it('returns an expired approval to the model as a denial, and the run continues', async () => {
    const write = vi.fn(() => 'wrote')
    const h = setup([writeCall], { tools: tools(write) })
    await executeRun(h.deps)
    await h.store.decide(h.runId, 'expired')
    const resumed = fakeModel([{ text: 'moving on' }])
    expect(await executeRun({ ...h.deps, resolveModel: async () => ({ model: resumed }) })).toEqual(
      { outcome: 'succeeded' },
    )
    expect(write).not.toHaveBeenCalled()
    expect(toolResultText((await h.store.steps(h.runId))[1]?.messages ?? [])[0]).toMatch(/expired/)
  })

  it('leaves the calls after the parked one unrun until the decision, then runs each once', async () => {
    const write = vi.fn(() => 'wrote')
    const h = setup(
      [
        {
          toolCalls: [
            { name: 'write', input: { path: 'a' } },
            { name: 'read', input: {} },
          ],
        },
      ],
      { tools: tools(write) },
    )
    await executeRun(h.deps)
    expect(await h.store.toolResult(h.runId, { stepIdx: 0, toolCallId: 'call_2' })).toBeNull()
    await h.store.decide(h.runId, 'approve')
    const resumed = fakeModel([{ text: 'fine' }])
    await executeRun({ ...h.deps, resolveModel: async () => ({ model: resumed }) })
    expect(write).toHaveBeenCalledTimes(1)
    expect(await h.store.toolResult(h.runId, { stepIdx: 0, toolCallId: 'call_2' })).not.toBeNull()
  })

  it('resumes idempotently after a crash once the approved call ran: the tool never runs twice', async () => {
    const write = vi.fn(() => 'wrote')
    const h = setup([writeCall], { tools: tools(write) })
    await executeRun(h.deps)
    await h.store.decide(h.runId, 'approve')
    // The resumed execution dies right after the tool result was recorded, before the tool row.
    vi.spyOn(h.store, 'appendToolStep').mockRejectedValueOnce(new Error('crash'))
    const first = fakeModel([{ text: 'never' }])
    await expect(
      executeRun({ ...h.deps, resolveModel: async () => ({ model: first }) }),
    ).rejects.toThrow('crash')
    expect(h.store.runs.get(h.runId)?.status).toBe('running')
    const second = fakeModel([{ text: 'done' }])
    expect(await executeRun({ ...h.deps, resolveModel: async () => ({ model: second }) })).toEqual({
      outcome: 'succeeded',
    })
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('a cancel from waiting_approval ends the run and a later decision is refused', async () => {
    const h = setup([writeCall], { tools: tools(() => 'wrote') })
    await executeRun(h.deps)
    expect(await h.store.transition(h.runId, 'waiting_approval', 'cancelled')).toBe(true)
    expect(await h.store.decide(h.runId, 'approve')).toBe(false)
    expect(await executeRun(h.deps)).toEqual({ outcome: 'skipped' })
  })

  it('stops without parking when cancel won the race', async () => {
    const h = setup([writeCall], { tools: tools(() => 'wrote') })
    vi.spyOn(h.store, 'park').mockResolvedValue(false)
    expect(await executeRun(h.deps)).toEqual({ outcome: 'superseded' })
  })
})
