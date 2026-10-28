import type { ActionClass, ArtifactId, Json, ProfileId, RunId } from '@mawl/contracts'
import type { ToolResultPart, ToolSet } from 'ai'
import type { z } from 'zod'

/** What the model sees as a tool result (AI SDK tool-result output). */
export type ToolResultOutput = ToolResultPart['output']

/**
 * Why a tool call produced no useful result. A closed set, so a result never carries exception or
 * provider text (it can echo secrets); the message next to it is written by Mawl.
 */
export type ToolErrorCode =
  | 'unknown_tool'
  | 'invalid_input'
  | 'denied'
  | 'failed'
  | 'one_question_at_a_time'
  | 'invalid_url'
  | 'blocked_address'
  | 'unreachable'
  | 'timeout'
  | 'too_many_redirects'
  | 'http_error'
  | 'unsupported_content_type'
  | 'search_unavailable'
  | 'artifact_not_found'

/** An event a tool asks the host to commit atomically with its recorded result. */
export type ToolEmit = {
  type: 'notify'
  payload: { title: string; body: string; level: 'info' | 'warn' | 'error' }
}

/** A run waiting on someone outside the loop. Generic so D2.4 approvals reuse the record. */
export interface WaitRequest {
  kind: 'question'
  payload: Json
}

/**
 * What a tool's `run` returns.
 * - `ok`: `text` is the result. It goes to the model wrapped as untrusted data; `note` is Mawl's own
 *   text and goes outside the wrapper. `emit` events are committed with the recorded result, so a
 *   resumed run never emits them twice.
 * - `error`: a typed failure; the model sees the code and the message (wrapped as data).
 * - `park`: the run waits (ask_user). Nothing is recorded; whoever resolves the wait records the
 *   result for this tool call and the run resumes.
 */
export type ToolOutcome =
  | { kind: 'ok'; text: string; note?: string; emit?: ToolEmit[] }
  | { kind: 'error'; code: ToolErrorCode; message: string }
  | { kind: 'park'; wait: WaitRequest }

export interface ToolContext {
  runId: RunId
  profileId: ProfileId
  /** Index of the model step that made the call. */
  stepIdx: number
  toolCallId: string
  signal: AbortSignal
}

/**
 * A registered tool. Input is parsed by `prepare` (zod), so the registry never handles an
 * unvalidated argument and needs no `any`.
 */
export interface Tool {
  name: string
  description: string
  inputSchema: z.ZodType
  actionClass: ActionClass
  /** False: the output is never moved to an artifact (read_artifact caps its own output). */
  artifacts: boolean
  prepare(
    raw: unknown,
  ):
    | { ok: true; argsRedacted: Json; run(ctx: ToolContext): Promise<ToolOutcome> }
    | { ok: false; issues: string }
}

export interface ToolGateRequest {
  runId: RunId
  profileId: ProfileId
  tool: string
  actionClass: ActionClass
  argsRedacted: Json
}

export type ToolGateDecision = { decision: 'allow' } | { decision: 'deny'; reason: string }

/**
 * The policy hook every tool call passes before it executes. D2.3 replaces the default with the
 * policy engine; D2.4 adds the `ask` path (approvals). This is the only place a decision is made.
 */
export interface ToolGate {
  check(request: ToolGateRequest): Promise<ToolGateDecision>
}

/** One tool call's recorded result, as the model saw it. */
export interface ToolResultRecord {
  toolName: string
  output: ToolResultOutput
  isError: boolean
  /** Short raw preview for the `run.tool_result` event. */
  preview: string
  artifactId: ArtifactId | null
}

export interface ToolCallKey {
  stepIdx: number
  toolCallId: string
}

/**
 * Persistence of tool calls, keyed by (run, step index, tool call id). The run store implements it.
 */
export interface ToolLedger {
  toolResult(runId: RunId, key: ToolCallKey): Promise<ToolResultRecord | null>
  /** Records a `run.tool_call` event. */
  recordToolCall(
    runId: RunId,
    call: { toolCallId: string; tool: string; argsRedacted: Json; actionClass: ActionClass },
  ): Promise<void>
  /**
   * Stores the result once, with its `run.tool_result` event and the `emit` events, atomically.
   * The first writer wins: a second call for the same key writes nothing and returns the stored
   * record.
   */
  recordToolResult(
    runId: RunId,
    key: ToolCallKey,
    record: ToolResultRecord,
    emit: readonly ToolEmit[],
  ): Promise<ToolResultRecord>
}

/** Large tool outputs. Reads are always scoped to one profile. */
export interface ArtifactStore {
  create(artifact: {
    profileId: ProfileId
    runId: RunId
    mime: string
    content: string
    preview: string
    tokenCount: number
  }): Promise<ArtifactId>
  /** Null when the artifact does not exist or belongs to another profile. */
  read(artifactId: ArtifactId, profileId: ProfileId): Promise<{ content: string } | null>
}

export interface ToolCallRequest {
  stepIdx: number
  toolCallId: string
  toolName: string
  input: unknown
}

export type InvokeResult =
  | { kind: 'result'; part: ToolResultPart; record: ToolResultRecord }
  | { kind: 'park'; wait: WaitRequest }

/** The tools of one run, bound to its run and profile. */
export interface RunTools {
  /** Definitions for the model (name, description, input schema). They carry no `execute`: the engine runs every call through `invoke`. */
  readonly toolSet: ToolSet
  /** Sorted tool names, in the shape the prompt assembler's `toolNames` takes. */
  readonly names: string[]
  invoke(
    call: ToolCallRequest,
    options: { ledger: ToolLedger; signal: AbortSignal; allowPark: boolean },
  ): Promise<InvokeResult>
}

export interface ToolRegistry {
  forRun(bind: { runId: RunId; profileId: ProfileId }): RunTools
}
