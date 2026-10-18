import {
  canTransition,
  newId,
  type ProfileId,
  type RunErrorCode,
  type RunId,
  type RunStatus,
  type Usage,
} from '@faire/contracts'
import { fakeModel, fixedClock } from '@faire/testkit'
import type { ModelMessage } from 'ai'
import type {
  ExecuteRunDeps,
  NewStep,
  PersistedStep,
  ProfileRecord,
  RunContext,
  RunRecord,
  RunStore,
  TextDelta,
  TransitionPatch,
} from './types.ts'

export interface RecordedEvent {
  type: 'run.status' | 'run.step'
  runId: RunId
  payload: Record<string, unknown>
}

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
    this.events.push({
      type: 'run.status',
      runId,
      payload: { status: to, prevStatus: from, ...(patch.error ? { error: patch.error } : {}) },
    })
    return true
  }

  async appendStep(runId: RunId, step: NewStep, runUsage: Usage): Promise<boolean> {
    const rows = this.stepRows.get(runId) ?? []
    const idxs = [step.idx, ...(step.toolMessages ? [step.idx + 1] : [])]
    if (rows.some((r) => idxs.includes(r.idx))) return false
    rows.push({ idx: step.idx, kind: 'model', messages: step.assistantMessages, usage: step.usage })
    this.events.push({ type: 'run.step', runId, payload: { idx: step.idx, kind: 'model' } })
    if (step.toolMessages) {
      rows.push({ idx: step.idx + 1, kind: 'tool', messages: step.toolMessages, usage: null })
      this.events.push({ type: 'run.step', runId, payload: { idx: step.idx + 1, kind: 'tool' } })
    }
    this.stepRows.set(runId, rows)
    const run = this.runs.get(runId)
    if (run) run.usage = runUsage
    return true
  }

  async succeed(
    runId: RunId,
    result: { text: string; usage: Usage; endedAt: Date },
  ): Promise<boolean> {
    const ok = await this.transition(runId, 'running', 'succeeded', {
      endedAt: result.endedAt,
      usage: result.usage,
    })
    if (ok) this.thread.push({ role: 'assistant', text: result.text, runId })
    return ok
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
