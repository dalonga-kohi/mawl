import {
  canTransition,
  newId,
  type ProfileId,
  type RunErrorCode,
  type RunId,
  type RunStatus,
  type Usage,
} from '@mawl/contracts'
import { fakeModel, fixedClock } from '@mawl/testkit'
import type { ModelMessage } from 'ai'
import { z } from 'zod'
import { defineTool } from '../tools/define.ts'
import { createToolRegistry, type ToolRegistryOptions } from '../tools/registry.ts'
import type {
  ToolCallKey,
  ToolEmit,
  ToolLedger,
  ToolRegistry,
  ToolResultRecord,
} from '../tools/types.ts'
import type {
  AppendResult,
  ExecuteRunDeps,
  NewStep,
  NewToolStep,
  PersistedStep,
  ProfileRecord,
  RunContext,
  RunRecord,
  RunStore,
  RunWait,
  TextDelta,
  TransitionPatch,
} from './types.ts'

export interface RecordedEvent {
  type: 'run.status' | 'run.step' | 'run.tool_call' | 'run.tool_result' | 'notify'
  runId: RunId
  payload: Record<string, unknown>
}

/**
 * A registry of plain test tools: each takes any object and returns its function's text. A function
 * that throws becomes a typed `failed` result, as with real tools.
 */
export function testTools(
  fns: Record<string, (input: Record<string, unknown>) => string | Promise<string>>,
  options: Omit<ToolRegistryOptions, 'tools'> = {},
): ToolRegistry {
  return createToolRegistry({
    ...options,
    tools: Object.entries(fns).map(([name, fn]) =>
      defineTool({
        name,
        description: `test tool ${name}`,
        inputSchema: z.record(z.string(), z.unknown()),
        actionClass: 'read',
        run: async (input) => ({ kind: 'ok', text: await fn(input) }),
      }),
    ),
  })
}

const toolKey = (runId: RunId, k: ToolCallKey) => `${runId}|${k.stepIdx}|${k.toolCallId}`

export interface MemoryMessage {
  role: 'user' | 'assistant'
  text: string
  runId: RunId | null
}

/** In-memory RunStore for engine tests. Mirrors the Drizzle store's semantics. */
export class MemoryRunStore implements RunStore {
  readonly runs = new Map<RunId, RunRecord & { error: RunErrorCode | null; endedAt: Date | null }>()
  readonly profiles = new Map<ProfileId, ProfileRecord>()
  readonly stepRows = new Map<RunId, PersistedStep[]>()
  readonly events: RecordedEvent[] = []
  readonly thread: MemoryMessage[] = []
  readonly toolResults = new Map<string, ToolResultRecord>()
  readonly waits = new Map<RunId, RunWait & { answer: string | null }>()

  addRun(
    over: Partial<RunRecord> & { modelMain?: string; persona?: string; prompt?: string } = {},
  ): RunId {
    const id = over.id ?? newId('run')
    const profileId = over.profileId ?? newId('profile')
    this.profiles.set(profileId, {
      id: profileId,
      personaMd: over.persona ?? 'You are Ada.',
      modelMain: over.modelMain ?? `${newId('credential')}:fake`,
    })
    this.runs.set(id, {
      id,
      profileId,
      threadId: over.threadId === undefined ? newId('thread') : over.threadId,
      status: over.status ?? 'queued',
      budget: over.budget ?? {},
      usage: over.usage ?? { inputTokens: 0, outputTokens: 0 },
      activeMs: over.activeMs ?? 0,
      startedAt: over.startedAt ?? null,
      error: null,
      endedAt: null,
    })
    this.thread.push({ role: 'user', text: over.prompt ?? 'hi', runId: id })
    return id
  }

  statuses(runId: RunId): RunStatus[] {
    return this.events
      .filter((e) => e.type === 'run.status' && e.runId === runId)
      .map((e) => e.payload.status as RunStatus)
  }

  async load(runId: RunId): Promise<RunContext | null> {
    const run = this.runs.get(runId)
    if (!run) return null
    const profile = this.profiles.get(run.profileId)
    if (!profile) return null
    return { run: { ...run }, profile }
  }

  async status(runId: RunId): Promise<RunStatus | null> {
    return this.runs.get(runId)?.status ?? null
  }

  async history(run: RunRecord): Promise<ModelMessage[]> {
    if (run.threadId === null) return []
    return this.thread.map((m) => ({ role: m.role, content: m.text }))
  }

  async steps(runId: RunId): Promise<PersistedStep[]> {
    return [...(this.stepRows.get(runId) ?? [])].sort((a, b) => a.idx - b.idx)
  }

  async transition(
    runId: RunId,
    from: RunStatus,
    to: RunStatus,
    patch: TransitionPatch = {},
  ): Promise<boolean> {
    const run = this.runs.get(runId)
    if (!run || run.status !== from) return false
    if (!canTransition(from, to)) throw new Error(`illegal transition ${from} -> ${to}`)
    run.status = to
    if (patch.startedAt) run.startedAt = patch.startedAt
    if (patch.endedAt) run.endedAt = patch.endedAt
    if (patch.error) run.error = patch.error
    if (patch.usage) run.usage = patch.usage
    run.activeMs += patch.activeMsDelta ?? 0
    this.events.push({
      type: 'run.status',
      runId,
      payload: { status: to, prevStatus: from, ...(patch.error ? { error: patch.error } : {}) },
    })
    return true
  }

  async appendStep(runId: RunId, step: NewStep, runUsage: Usage): Promise<AppendResult> {
    if (this.runs.get(runId)?.status !== 'running') return 'not_running'
    const rows = this.stepRows.get(runId) ?? []
    if (rows.some((r) => r.idx === step.idx)) return 'duplicate'
    rows.push({ idx: step.idx, kind: 'model', messages: step.assistantMessages, usage: step.usage })
    this.events.push({ type: 'run.step', runId, payload: { idx: step.idx, kind: 'model' } })
    this.stepRows.set(runId, rows)
    const run = this.runs.get(runId)
    if (run) {
      run.usage = runUsage
      run.activeMs += step.activeMsDelta
    }
    return 'written'
  }

  async succeed(
    runId: RunId,
    result: { text: string; usage: Usage; endedAt: Date; activeMsDelta: number },
  ): Promise<boolean> {
    const ok = await this.transition(runId, 'running', 'succeeded', {
      endedAt: result.endedAt,
      usage: result.usage,
      activeMsDelta: result.activeMsDelta,
    })
    if (ok) this.thread.push({ role: 'assistant', text: result.text, runId })
    return ok
  }

  async appendToolStep(runId: RunId, step: NewToolStep): Promise<AppendResult> {
    if (this.runs.get(runId)?.status !== 'running') return 'not_running'
    const rows = this.stepRows.get(runId) ?? []
    if (rows.some((r) => r.idx === step.idx)) return 'duplicate'
    rows.push({ idx: step.idx, kind: 'tool', messages: step.toolMessages, usage: null })
    this.stepRows.set(runId, rows)
    this.events.push({ type: 'run.step', runId, payload: { idx: step.idx, kind: 'tool' } })
    const run = this.runs.get(runId)
    if (run) run.activeMs += step.activeMsDelta
    return 'written'
  }

  async park(runId: RunId, wait: RunWait, activeMsDelta: number): Promise<boolean> {
    const ok = await this.transition(runId, 'running', 'waiting_user', { activeMsDelta })
    if (ok) this.waits.set(runId, { ...wait, answer: null })
    return ok
  }

  async toolResult(runId: RunId, key: ToolCallKey): Promise<ToolResultRecord | null> {
    return this.toolResults.get(toolKey(runId, key)) ?? null
  }

  async recordToolCall(runId: RunId, call: Parameters<ToolLedger['recordToolCall']>[1]) {
    this.events.push({ type: 'run.tool_call', runId, payload: { ...call } })
  }

  async recordToolResult(
    runId: RunId,
    key: ToolCallKey,
    record: ToolResultRecord,
    emit: readonly ToolEmit[],
  ): Promise<ToolResultRecord> {
    const k = toolKey(runId, key)
    const existing = this.toolResults.get(k)
    if (existing) return existing
    this.toolResults.set(k, record)
    this.events.push({
      type: 'run.tool_result',
      runId,
      payload: { toolCallId: key.toolCallId, preview: record.preview, isError: record.isError },
    })
    for (const e of emit) this.events.push({ type: e.type, runId, payload: { ...e.payload } })
    return record
  }

  /** What the server's reply does: record the answer as the tool result and resume the run. */
  async reply(runId: RunId, record: ToolResultRecord): Promise<boolean> {
    const wait = this.waits.get(runId)
    if (!wait || wait.answer !== null) return false
    if (!(await this.transition(runId, 'waiting_user', 'running'))) return false
    wait.answer = record.preview
    await this.recordToolResult(runId, wait, record, [])
    return true
  }
}

export const NOW = '2026-01-02T03:04:05.000Z'

export function setup(script: Parameters<typeof fakeModel>[0], over: Partial<ExecuteRunDeps> = {}) {
  const store = new MemoryRunStore()
  const runId = store.addRun()
  const model = fakeModel(script, { chunkSize: 3 })
  const clock = fixedClock(NOW)
  const deltas: TextDelta[] = []
  const deps: ExecuteRunDeps = {
    runId,
    store,
    resolveModel: async () => ({ model }),
    clock,
    signal: new AbortController().signal,
    onDelta: (d) => deltas.push(d),
    ...over,
  }
  return { store, runId, model, clock, deltas, deps }
}
