import type {
  ProfileId,
  RunBudget,
  RunErrorCode,
  RunId,
  RunStatus,
  StepKind,
  ThreadId,
  Usage,
} from '@faire/contracts'
import type { LanguageModel, ModelMessage, ToolSet } from 'ai'

/** The run row, as the engine needs it. */
export interface RunRecord {
  id: RunId
  profileId: ProfileId
  threadId: ThreadId | null
  status: RunStatus
  budget: RunBudget
  usage: Usage
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
 * What one model step produced. A step that ran tools also carries the tool messages: both rows
 * (model at `idx`, tool at `idx + 1`) are written in one transaction.
 */
export interface NewStep {
  /** Index of the model row. The tool row, if any, takes `idx + 1`. */
  idx: number
  assistantMessages: ModelMessage[]
  toolMessages: ModelMessage[] | null
  usage: Usage
}

export interface TransitionPatch {
  startedAt?: Date
  endedAt?: Date
  error?: RunErrorCode
  usage?: Usage
}

export interface RunContext {
  run: RunRecord
  profile: ProfileRecord
}

/**
 * Persistence port of the run engine. The Drizzle implementation lives in the server; core
 * tests use an in-memory double. Every state change is a compare-and-set that also records a
 * `run.status` event in the same atomic unit, and `false` means someone else changed the run
 * first (cancel, pause), so the engine must stop without overwriting.
 */
export interface RunStore {
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
   * running usage total, atomically. Returns false when a row with that idx already exists
   * (another execution of the same run got there first); nothing is written then.
   */
  appendStep(runId: RunId, step: NewStep, runUsage: Usage): Promise<boolean>
  /**
   * Inserts the assistant message and moves running to succeeded in one transaction.
   * False when the CAS was lost (nothing is written).
   */
  succeed(runId: RunId, result: { text: string; usage: Usage; endedAt: Date }): Promise<boolean>
}

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
  tools?: ToolSet
  clock: Clock
  /**
   * Aborted by the host: reason `ABORT_SHUTDOWN` leaves the run `running` so a later job resumes it;
   * any other reason means cancel or pause already set the state, so the engine just stops.
   */
  signal: AbortSignal
  /** Ephemeral text tokens. Never persisted per token. */
  onDelta?: (delta: TextDelta) => void
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
 */
export type RunOutcome =
  | { outcome: 'skipped' }
  | { outcome: 'succeeded' }
  | { outcome: 'failed'; error: RunErrorCode }
  | { outcome: 'superseded' }
  | { outcome: 'interrupted' }
