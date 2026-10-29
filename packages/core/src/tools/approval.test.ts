import { newId, type RunId } from '@mawl/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  APPROVAL_TTL_MS,
  approvalRefusedRecord,
  argsHash,
  canonicalArgs,
  replayApproved,
} from './approval.ts'
import { defineTool } from './define.ts'
import { createToolRegistry } from './registry.ts'
import { MemoryLedger } from './test-util.ts'
import type { ApprovedCall, InvokeResult, ToolGate, ToolGateDecision } from './types.ts'

const runId = newId('run')
const profileId = newId('profile')
const key = { stepIdx: 2, toolCallId: 'call_7' }

const ask: ToolGateDecision = {
  decision: 'park',
  reason: 'Default for send_message.',
  audit: { level: 'ask', source: 'global' },
}

function sendTool(ran: unknown[]) {
  return defineTool({
    name: 'send',
    description: 'send a message',
    inputSchema: z.strictObject({ to: z.string(), body: z.string().max(5000) }),
    actionClass: 'send_message',
    run: async (input) => {
      ran.push(input)
      return { kind: 'ok', text: `sent to ${input.to}` }
    },
  })
}

function harness(decision: ToolGateDecision | (() => ToolGateDecision) = ask, forRun = runId) {
  const ran: unknown[] = []
  const ledger = new MemoryLedger()
  const gate: ToolGate = {
    check: vi.fn(async () => (typeof decision === 'function' ? decision() : decision)),
  }
  const tools = createToolRegistry({ tools: [sendTool(ran)], gate }).forRun({
    runId: forRun,
    profileId,
  })
  const invoke = (input: unknown, over: { allowPark?: boolean } = {}) =>
    tools.invoke(
      { ...key, toolName: 'send', input },
      { ledger, signal: new AbortController().signal, allowPark: over.allowPark ?? true },
    )
  return { ran, ledger, gate, invoke }
}

const input = { to: 'bob@example.com', body: 'hello' }
const text = canonicalArgs(input)
const approved = (over: Partial<Extract<ApprovedCall, { status: 'approved' }>> = {}) =>
  ({ status: 'approved', tool: 'send', argsText: text, argsHash: argsHash(text), ...over }) as const

function errorText(r: InvokeResult): string {
  if (r.kind !== 'result') throw new Error('expected a result')
  const o = r.part.output
  return o.type === 'error-text' || o.type === 'text' ? o.value : ''
}

describe('approval helpers', () => {
  it('hashes the stored text with SHA-256', () => {
    expect(argsHash('{}')).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a')
  })

  it('keeps pending approvals for 24 hours', () => {
    expect(APPROVAL_TTL_MS).toBe(86_400_000)
  })

  it('tells the model a denial and an expiry apart, both as denied errors', () => {
    const denied = approvalRefusedRecord('send', 'denied')
    const expired = approvalRefusedRecord('send', 'expired')
    expect(denied.isError && expired.isError).toBe(true)
    expect(denied.preview).toMatch(/owner denied/)
    expect(expired.preview).toMatch(/expired/)
  })
})

describe('tool registry: an ask parks the call for approval', () => {
  it('parks with the exact argument text, its hash, the redacted copy and the reason', async () => {
    const h = harness()
    const r = await h.invoke(input)
    expect(h.ran).toEqual([])
    expect(r).toEqual({
      kind: 'park',
      wait: {
        kind: 'approval',
        payload: { tool: 'send', reason: 'Default for send_message.' },
        approval: {
          tool: 'send',
          actionClass: 'send_message',
          argsText: text,
          argsHash: argsHash(text),
          argsRedacted: input,
          reason: 'Default for send_message.',
        },
      },
    })
    // The owner sees the call in the event; no result is recorded until the decision.
    expect(h.ledger.events.map((e) => e.type)).toEqual(['run.tool_call'])
    expect(h.ledger.events[0]?.payload).toMatchObject({ level: 'ask', source: 'global' })
    expect(h.ledger.events[0]?.payload).not.toHaveProperty('approved')
    expect(h.ledger.results.size).toBe(0)
  })

  it('keeps the full arguments out of the wait payload, which is not encrypted', async () => {
    const h = harness()
    const r = await h.invoke({ to: 'bob@example.com', body: 'x'.repeat(400) })
    if (r.kind !== 'park' || r.wait.kind !== 'approval') throw new Error('expected an approval')
    expect(JSON.stringify(r.wait.payload)).not.toContain('bob@example.com')
    expect(r.wait.approval.argsText).toContain('x'.repeat(400))
    expect(JSON.stringify(r.wait.approval.argsRedacted)).not.toContain('x'.repeat(400))
  })

  it('refuses a handoff instead of asking for an approval: the owner must do it', async () => {
    const h = harness({
      decision: 'park',
      reason: 'Payments are always handed to you.',
      audit: { level: 'handoff', source: 'global' },
    })
    const r = await h.invoke(input)
    expect(r.kind).toBe('result')
    expect(errorText(r)).toMatch(/denied/)
    expect(errorText(r)).toMatch(/hand/i)
    expect(h.ran).toEqual([])
  })

  it('answers denied when this step already parks on another call', async () => {
    const h = harness()
    const r = await h.invoke(input, { allowPark: false })
    expect(r.kind).toBe('result')
    expect(errorText(r)).toMatch(/denied/)
    expect(h.ran).toEqual([])
  })
})

describe('tool registry: an approved call replays the stored arguments', () => {
  it('runs once with the stored arguments and marks the event approved', async () => {
    const h = harness()
    h.ledger.grant(runId, key, approved())
    const r = await h.invoke(input)
    expect(r.kind).toBe('result')
    expect(errorText(r)).toContain('sent to bob@example.com')
    expect(h.ran).toEqual([input])
    expect(h.ledger.events[0]?.payload).toMatchObject({ level: 'ask', approved: true })
    // A resumed run gets the recorded result; the tool never runs twice.
    await h.invoke(input)
    expect(h.ran).toHaveLength(1)
  })

  it('fails closed when the stored text does not match its hash (tampered)', async () => {
    const h = harness()
    const evil = canonicalArgs({ to: 'eve@example.com', body: 'hello' })
    h.ledger.grant(runId, key, approved({ argsText: evil }))
    const r = await h.invoke(input)
    expect(errorText(r)).toMatch(/denied/)
    expect(errorText(r)).toMatch(/does not match/)
    expect(h.ran).toEqual([])
    expect(h.ledger.events[0]?.payload).not.toHaveProperty('approved')
  })

  it('fails closed when text and hash agree but the recorded call differs from the approved one', async () => {
    const h = harness()
    const other = canonicalArgs({ to: 'eve@example.com', body: 'hello' })
    h.ledger.grant(runId, key, approved({ argsText: other, argsHash: argsHash(other) }))
    expect(errorText(await h.invoke(input))).toMatch(/does not match/)
    expect(h.ran).toEqual([])
  })

  it('fails closed on an approval for another tool or one that cannot be decrypted', async () => {
    const a = harness()
    a.ledger.grant(runId, key, approved({ tool: 'delete_everything' }))
    expect(errorText(await a.invoke(input))).toMatch(/denied/)
    const b = harness()
    b.ledger.grant(runId, key, { status: 'unreadable' })
    expect(errorText(await b.invoke(input))).toMatch(/denied/)
    expect([...a.ran, ...b.ran]).toEqual([])
  })

  it('never lifts a denial: a block decided after the approval wins', async () => {
    const h = harness({
      decision: 'deny',
      reason: 'A rule you set sets block.',
      audit: { level: 'block', source: 'user_rule' },
    })
    h.ledger.grant(runId, key, approved())
    expect(errorText(await h.invoke(input))).toMatch(/denied/)
    expect(h.ran).toEqual([])
  })

  it('never uses an approval of another run (a teammate run inherits nothing, R19)', async () => {
    const other: RunId = newId('run')
    const h = harness(ask, other)
    h.ledger.grant(runId, key, approved())
    const r = await h.invoke(input)
    expect(r.kind).toBe('park')
    expect(h.ran).toEqual([])
  })
})

describe('replayApproved', () => {
  const ran: unknown[] = []
  const tool = sendTool(ran)

  it('refuses stored text that does not parse back to itself', () => {
    const spaced = JSON.stringify(input, null, 1)
    expect(
      replayApproved(
        tool,
        { status: 'approved', tool: 'send', argsText: spaced, argsHash: argsHash(spaced) },
        { args: JSON.parse(spaced) },
      ),
    ).toBeNull()
  })

  it('returns a run bound to the stored arguments', async () => {
    const r = replayApproved(tool, approved(), { args: input })
    expect(r?.args).toEqual(input)
  })
})
