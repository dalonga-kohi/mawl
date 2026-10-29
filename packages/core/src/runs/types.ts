import type {
  ProfileId,
  RunBudget,
  RunErrorCode,
  RunId,
  RunStatus,
  StepKind,
  ThreadId,
  Usage,
} from '@mawl/contracts'
import type { LanguageModel, ModelMessage } from 'ai'
import type { ToolLedger, ToolRegistry, WaitRequest } from '../tools/types.ts'

/** The run row, as the engine needs it. */
export interface RunRecord {
  id: RunId
  profileId: ProfileId
  threadId: ThreadId | null
  status: RunStatus
  budget: RunBudget
  usage: Usage
  /** Milliseconds the run was actually working. The wall-clock budget counts this, not paused time or downtime. */
  activeMs: number
  startedAt: Date | null
}

export interface ProfileRecord {
  id: ProfileId
  personaMd: string
  /** `<credentialId>:<modelId>`, see `parseModelRef` in contracts. */
  modelMain: string
}

/** One persisted step row. `messages` are the AI SDK response messages the step produced. */
export interface PersistedStep {
  idx: number
  kind: StepKind
  messages: ModelMessage[]
  usage: Usage | null
}

/**
 * What one model step produced. The model row is written before any of its tool calls runs, so a
 * crash during the tools resumes with the exact calls the model made; the tool row (`idx + 1`)
 * follows through `appendToolStep` once every call has a result.
 */
export interface NewStep {
  /** Index of the model row. The tool row, if any, takes `idx + 1`. */
  idx: number
  assistantMessages: ModelMessage[]
  usage: Usage
  /** Active time since the previous checkpoint, added to the run's `activeMs` in the same transaction. */
  activeMsDelta: number
}

/** The tool row of a model step, written once every tool call of that step has a result. */
export interface NewToolStep {
  /** The model row's idx + 1. */
  idx: number
  toolMessages: ModelMessage[]
  activeMsDelta: number
}

/**
 * What a parked run waits for, tied to the tool call that asked: a question (resumed by recording
 * its answer as the call's result) or an approval (resumed by approving it, so the call replays,
 * or by denying, expiring or cancelling it).
 */
export type RunWait = WaitRequest & {
  /** Index of the model step whose tool call parked the run. */
  stepIdx: number
  toolCallId: string
}

export interface TransitionPatch {
  startedAt?: Date
  endedAt?: Date
  error?: RunErrorCode
  usage?: Usage
  /** Added to the run's `activeMs`. */
  activeMsDelta?: number
}

export interface RunContext {
  run: RunRecord
  profile: ProfileRecord
}

/**
 * Persistence port of the run engine. The Drizzle implementation lives in the server; core
 * tests use an in-memory double. Every state change is a compare-and-set that also records a
 * `run.status` event in the same atomic unit, and `false` means someone else changed the run
 * first (cancel, pause), so the engine must stop without overwriting. It is also the tool ledger:
 * tool results are recorded per (run, step idx, tool call id), so a resumed run never runs a
 * recorded call again.
 */
export interface RunStore extends ToolLedger {
  load(runId: RunId): Promise<RunContext | null>
  /** Current status only (cheap re-read before each step). Null when the run is gone. */
  status(runId: RunId): Promise<RunStatus | null>
  /** Prior thread messages as model messages, oldest first, including this run's user message. */
  history(run: RunRecord): Promise<ModelMessage[]>
  /** Persisted steps, ordered by idx. */
  steps(runId: RunId): Promise<PersistedStep[]>
  transition(
    runId: RunId,
    from: RunStatus,
    to: RunStatus,
    patch?: TransitionPatch,
  ): Promise<boolean>
  /**
   * Writes the model row (and tool row) plus one `run.step` event per row, and the run's
   * running usage total, atomically, but only while the run is still `running` (the run row is
   * locked for the check). Nothing is written for duplicate (a row with that idx exists: another
   * execution of the same run got there first) or `not_running` (cancel or pause won).
   */
  appendStep(runId: RunId, step: NewStep, runUsage: Usage): Promise<AppendResult>
  /** Writes a tool row and its `run.step` event, with the same rules as `appendStep`. */
  appendToolStep(runId: RunId, step: NewToolStep): Promise<AppendResult>
  /**
   * Parks the run: records the wait and moves `running` to `waiting_user` (a question) or
   * `waiting_approval` (an approval: the store also keeps the call's argument text encrypted with
   * its hash and emits `approval.created`), with its `run.status` event, atomically. False when
   * the CAS was lost (cancel or pause won); nothing is written then.
   */
  park(runId: RunId, wait: RunWait, activeMsDelta: number): Promise<boolean>
  /**
   * Inserts the assistant message and moves running to succeeded in one transaction.
   * False when the CAS was lost (nothing is written).
   */
  succeed(
    runId: RunId,
    result: { text: string; usage: Usage; endedAt: Date; activeMsDelta: number },
  ): Promise<boolean>
}

export type AppendResult = 'written' | 'duplicate' | 'not_running'

export interface Clock {
  now(): Date
}

export interface RunDefaults {
  maxSteps: number
  maxTokens: number
  maxWallClockMs: number
}

export const DEFAULT_RUN_BUDGET: RunDefaults = {
  maxSteps: 20,
  maxTokens: 200_000,
  maxWallClockMs: 15 * 60_000,
}

export interface TextDelta {
  runId: RunId
  profileId: ProfileId
  stepIdx: number
  text: string
}

/** Abort reasons the host uses on the run's signal. */
export const ABORT_SHUTDOWN = 'shutdown'

export interface ResolvedModel {
  model: LanguageModel
  /** Provider capability: false means tools are never passed to this model. Default true. */
  supportsTools?: boolean
}

export interface ExecuteRunDeps {
  runId: RunId
  store: RunStore
  /** Builds the model for the profile's `modelMain`. Throws `ModelNotConfiguredError` or a `ProviderFailureError`. */
  resolveModel(run: RunRecord, profile: ProfileRecord): Promise<ResolvedModel>
  /**
   * The tools offered to the model (only when it `supportsTools`). The engine runs every call
   * itself through the registry's `invoke`, after the model step is persisted.
   */
  tools?: ToolRegistry
  clock: Clock
  /**
   * Aborted by the host: reason `ABORT_SHUTDOWN` leaves the run `running` so a later job resumes it;
   * any other reason means cancel or pause already set the state, so the engine just stops.
   */
  signal: AbortSignal
  /** Ephemeral text tokens. Never persisted per token. */
  onDelta?: (delta: TextDelta) => void
  /** The model step's stream is over (finished, failed or aborted), so no more deltas follow for it. */
  onStepEnd?: (info: { runId: RunId; profileId: ProfileId; stepIdx: number }) => void
  defaults?: RunDefaults
  /**
   * Called when the engine fails the run. Carries the closed code and the exception NAME only,
   * so the host can log without ever seeing provider text.
   */
  onFailure?: (info: { runId: RunId; code: RunErrorCode; errName: string }) => void
}

/**
 * - `skipped`: nothing to do (terminal, paused, waiting, or unknown run).
 * - `succeeded` / `failed`: the engine ended the run.
 * - `superseded`: cancel or pause won; the engine stopped without writing.
 * - `interrupted`: shutdown, or a duplicate execution hit an existing step; the run is untouched.
 * - `waiting`: the run parked (`waiting_user` or `waiting_approval`); the job ends and a reply or a
 *   decision enqueues a new one.
 */
export type RunOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'waiting' }
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; error: RunErrorCode }
  | { outcome: 'superseded' }
  | { outcome: 'interrupted' }
