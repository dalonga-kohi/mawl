import type {
  ActionClass,
  ArtifactId,
  Json,
  PolicyLevel,
  PolicySource,
  ProfileId,
  RunId,
} from '@mawl/contracts'
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
  | 'redirect_refused'
  | 'http_error'
  | 'unsupported_content_type'
  | 'search_unavailable'
  | 'artifact_not_found'

/** An event a tool asks the host to commit atomically with its recorded result. */
export type ToolEmit = {
  type: 'notify'
  payload: { title: string; body: string; level: 'info' | 'warn' | 'error' }
}

/**
 * A tool call the policy parked for the owner (`ask`). The store keeps `argsText` encrypted with
 * its hash; approve replays exactly that text (R9). Only `argsRedacted` is ever shown.
 */
export interface ApprovalRequest {
  tool: string
  actionClass: ActionClass
  /** The parsed arguments as JSON (`canonicalArgs`). Never logged, shown or put in an event. */
  argsText: string
  /** SHA-256 hex of `argsText` (`argsHash`). */
  argsHash: string
  argsRedacted: Json
  /** Mawl's own text: why the call needs the owner. */
  reason: string
}

/**
 * A run waiting on someone outside the loop: a question (`ask_user`, state `waiting_user`) or an
 * approval (`waiting_approval`). `payload` is what the wait row shows; it never holds arguments.
 */
export type WaitRequest =
  | { kind: 'question'; payload: Json }
  | { kind: 'approval'; payload: Json; approval: ApprovalRequest }

/**
 * What the ledger knows about an approved call: the stored text and hash (decrypted on the
 * server), or `unreadable` when it cannot be decrypted. Null when the call has no approval in
 * the approved state. Keyed by (run, step idx, tool call id), so no other run can use it (R19).
 */
export type ApprovedCall =
  | { status: 'approved'; tool: string; argsText: string; argsHash: string }
  | { status: 'unreadable' }

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
  /**
   * Asks the policy whether a redirect from the call's url to `to` may be followed (the gate's
   * `checkRedirect`; false when the gate has none). Set by the registry.
   */
  allowRedirect?(from: string, to: string): Promise<boolean>
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
    | { ok: true; args: Json; argsRedacted: Json; run(ctx: ToolContext): Promise<ToolOutcome> }
    | { ok: false; issues: string }
}

export interface ToolGateRequest {
  runId: RunId
  profileId: ProfileId
  tool: string
  actionClass: ActionClass
  /**
   * The parsed arguments, unredacted and uncut, so the policy matches what will run (a cut shell
   * command could hide a chained one). Never stored or shown; the event gets `argsRedacted`.
   */
  args: Json
  argsRedacted: Json
}

/** How the policy engine reached a decision, written into the `run.tool_call` event. */
export interface ToolGateAudit {
  level: PolicyLevel
  source: PolicySource
  /** Set when the profile runs in Autopilot. */
  mode?: 'autopilot'
}

/**
 * - `allow`: the tool runs.
 * - `deny`: the model gets a typed `denied` result with the reason.
 * - `park`: the call needs the owner (`audit.level` is `ask` or `handoff`). An `ask` parks the run
 *   for an approval; a `handoff` is refused until takeover exists (the owner must act, not approve).
 */
export type ToolGateDecision =
  | { decision: 'allow'; audit?: ToolGateAudit }
  | { decision: 'deny'; reason: string; audit?: ToolGateAudit }
  | { decision: 'park'; reason: string; audit: ToolGateAudit }

/**
 * The policy hook every tool call passes before it executes. The server passes the policy engine
 * (`policyGate`). This is the only place a decision is made.
 */
export interface ToolGate {
  check(request: ToolGateRequest): Promise<ToolGateDecision>
  /**
   * A tool is about to follow a redirect from its call's url (`from`) to `to`. True lets it
   * follow. A gate without this method refuses every redirect.
   */
  checkRedirect?(request: RedirectCheck): Promise<boolean>
}

export interface RedirectCheck {
  runId: RunId
  profileId: ProfileId
  tool: string
  actionClass: ActionClass
  /** The url the call asked for (what the policy decided on). */
  from: string
  to: string
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
  /** Records a `run.tool_call` event, with the policy audit when the gate gave one. */
  recordToolCall(
    runId: RunId,
    call: {
      toolCallId: string
      tool: string
      argsRedacted: Json
      actionClass: ActionClass
      level?: PolicyLevel
      source?: PolicySource
      mode?: 'autopilot'
      /** The call runs because the owner approved it. */
      approved?: true
    },
  ): Promise<void>
  /** The approval of this call when it is approved (see `ApprovedCall`), else null. */
  approvedCall(runId: RunId, key: ToolCallKey): Promise<ApprovedCall | null>
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
