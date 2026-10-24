import type { RunErrorCode, Usage } from '@mawl/contracts'
import {
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolCallPart,
  type ToolResultPart,
} from 'ai'
import { ProviderFailureError } from '../providers/failure.ts'
import { createToolRegistry } from '../tools/registry.ts'
import type { WaitRequest } from '../tools/types.ts'
import { ModelNotConfiguredError, toRunErrorCode } from './errors.ts'
import {
  ABORT_SHUTDOWN,
  DEFAULT_RUN_BUDGET,
  type ExecuteRunDeps,
  type PersistedStep,
  type ResolvedModel,
  type RunOutcome,
} from './types.ts'

/** Provider retries per model call (the AI SDK retries retryable API errors). */
const MAX_RETRIES = 2

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0 }

export function addUsage(a: Usage, b: Usage): Usage {
  const cached =
    a.cachedTokens === undefined && b.cachedTokens === undefined
      ? undefined
      : (a.cachedTokens ?? 0) + (b.cachedTokens ?? 0)
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    ...(cached === undefined ? {} : { cachedTokens: cached }),
  }
}

/** Text parts of one model message, in order. */
function textOf(message: ModelMessage): string {
  if (message.role !== 'assistant') return ''
  if (typeof message.content === 'string') return message.content
  return message.content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('')
}

/** One entry per model step that said something, joined with a blank line. */
export function finalText(steps: readonly PersistedStep[]): string {
  return steps
    .filter((s) => s.kind === 'model')
    .map((s) => s.messages.map(textOf).join(''))
    .filter((t) => t.length > 0)
    .join('\n\n')
}

function sumUsage(steps: readonly PersistedStep[]): Usage {
  return steps.reduce((acc, s) => (s.usage ? addUsage(acc, s.usage) : acc), ZERO_USAGE)
}

/**
 * Runs one run to its end, or as far as this execution may take it. Each model step is persisted
 * (with its tool results) before the next starts, so a crashed or restarted execution resumes
 * from the last persisted step. Model and provider failures end the run as `failed` with a closed
 * error code; only infrastructure errors (the store) throw, so the job can be retried.
 */
export async function executeRun(deps: ExecuteRunDeps): Promise<RunOutcome> {
  const { runId, store, clock, signal } = deps
  const defaults = deps.defaults ?? DEFAULT_RUN_BUDGET

  const ctx = await store.load(runId)
  if (!ctx) return { outcome: 'skipped' }
  const { profile } = ctx
  let run = ctx.run

  // This execution's time zero. Time before it (paused, queued again, or a crash gap) is not counted.
  const segmentStart = clock.now().getTime()
  if (run.status === 'queued') {
    // A resumed run keeps the start time of its first execution.
    const startedAt = run.startedAt ?? clock.now()
    if (!(await store.transition(runId, 'queued', 'running', run.startedAt ? {} : { startedAt }))) {
      return { outcome: 'superseded' }
    }
    run = { ...run, status: 'running', startedAt }
  } else if (run.status !== 'running') {
    return { outcome: 'skipped' }
  }
  // A run already running here is a crash resume: carry on from the persisted steps.
  // Active time: what earlier executions persisted, plus this one so far, up to the last checkpoint.
  const activeBefore = run.activeMs
  let checkpoint = segmentStart
  const activeNow = () => activeBefore + (clock.now().getTime() - segmentStart)
  /** Active time since the last checkpoint; moves the checkpoint. */
  const takeDelta = () => {
    const now = clock.now().getTime()
    const delta = Math.max(0, now - checkpoint)
    checkpoint = now
    return delta
  }

  const budget = {
    maxSteps: run.budget.maxSteps ?? defaults.maxSteps,
    maxTokens: run.budget.maxTokens ?? defaults.maxTokens,
    maxWallClockMs: run.budget.maxWallClockMs ?? defaults.maxWallClockMs,
  }

  const interruptedOrSuperseded = (): RunOutcome =>
    signal.reason === ABORT_SHUTDOWN ? { outcome: 'interrupted' } : { outcome: 'superseded' }

  async function fail(code: RunErrorCode, usage: Usage): Promise<RunOutcome> {
    const ok = await store.transition(runId, 'running', 'failed', {
      error: code,
      endedAt: clock.now(),
      usage,
      activeMsDelta: takeDelta(),
    })
    return ok ? { outcome: 'failed', error: code } : { outcome: 'superseded' }
  }

  const persisted = await store.steps(runId)
  let usage = sumUsage(persisted)

  let resolved: ResolvedModel
  try {
    resolved = await deps.resolveModel(run, profile)
  } catch (err) {
    // Only errors with a closed code fail the run. Anything else is infrastructure (a database or
    // network hiccup while looking the model up): rethrow so the job retries.
    if (!(err instanceof ModelNotConfiguredError) && !(err instanceof ProviderFailureError))
      throw err
    deps.onFailure?.({ runId, code: toRunErrorCode(err), errName: errName(err) })
    return fail(toRunErrorCode(err), usage)
  }

  const history = await store.history(run)
  const steps: PersistedStep[] = [...persisted]
  const bind = { runId, profileId: profile.id }
  const offered =
    resolved.supportsTools === false || deps.tools === undefined
      ? undefined
      : deps.tools.forRun(bind)
  const sdkTools = offered && offered.names.length > 0 ? offered.toolSet : undefined
  // Calls the model made without tools on offer (or after they went away on resume) still get an
  // answer: the empty registry gives each one a typed unknown_tool result.
  const runner = offered ?? createToolRegistry({ tools: [] }).forRun(bind)

  /**
   * Runs the tool calls of a persisted model step through the registry, in call order. Results
   * that are already recorded (a resumed run) are reused, so no call runs twice. Returns the
   * written tool row, or the outcome that ends this execution.
   */
  async function runTools(
    modelStep: PersistedStep,
    calls: readonly ToolCallPart[],
  ): Promise<PersistedStep | RunOutcome> {
    const remainingMs = budget.maxWallClockMs - activeNow()
    if (remainingMs <= 0) return fail('budget_wall_clock', usage)
    const wall = new AbortController()
    const timer = setTimeout(() => wall.abort(new Error('wall clock')), remainingMs)
    const callSignal = AbortSignal.any([signal, wall.signal])
    const parts: ToolResultPart[] = []
    let parked: { call: ToolCallPart; wait: WaitRequest } | undefined
    try {
      for (const call of calls) {
        if (callSignal.aborted) break
        const result = await runner.invoke(
          {
            stepIdx: modelStep.idx,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            input: call.input,
          },
          { ledger: store, signal: callSignal, allowPark: parked === undefined },
        )
        if (result.kind === 'park') parked = { call, wait: result.wait }
        else parts.push(result.part)
      }
    } catch (err) {
      // A store error while nothing aborted is infrastructure: rethrow so the job retries.
      if (!callSignal.aborted) throw err
    } finally {
      clearTimeout(timer)
    }
    if (wall.signal.aborted) return fail('budget_wall_clock', usage)
    if (signal.aborted) return interruptedOrSuperseded()

    if (parked) {
      const ok = await store.park(
        runId,
        { ...parked.wait, stepIdx: modelStep.idx, toolCallId: parked.call.toolCallId },
        takeDelta(),
      )
      return ok ? { outcome: 'waiting' } : { outcome: 'superseded' }
    }

    const toolMessage: ModelMessage = { role: 'tool', content: parts }
    const idx = modelStep.idx + 1
    const written = await store.appendToolStep(runId, {
      idx,
      toolMessages: [toolMessage],
      activeMsDelta: takeDelta(),
    })
    if (written === 'duplicate') return { outcome: 'interrupted' }
    if (written === 'not_running') return { outcome: 'superseded' }
    return { idx, kind: 'tool', messages: [toolMessage], usage: null }
  }

  for (;;) {
    const last = steps.at(-1)
    if (last?.kind === 'model') {
      // A model step without tool calls is the final answer (on resume: only the finish was missed).
      const calls = toolCallsOf(last)
      if (calls.length === 0) break
      // Its tool calls have no tool row yet: run them (on resume, only the unrecorded ones run).
      const next = await runTools(last, calls)
      if ('outcome' in next) return next
      steps.push(next)
      continue
    }

    if (signal.aborted) return interruptedOrSuperseded()
    const status = await store.status(runId)
    if (status !== 'running') return { outcome: 'superseded' }

    const modelSteps = steps.filter((s) => s.kind === 'model').length
    if (modelSteps >= budget.maxSteps) return fail('budget_steps', usage)
    if (usage.inputTokens + usage.outputTokens >= budget.maxTokens) {
      return fail('budget_tokens', usage)
    }
    const remainingMs = budget.maxWallClockMs - activeNow()
    if (remainingMs <= 0) return fail('budget_wall_clock', usage)

    const idx = last ? last.idx + 1 : 0

    const wall = new AbortController()
    const timer = setTimeout(() => wall.abort(new Error('wall clock')), remainingMs)
    let streamError: unknown
    let hadError = false
    const result = streamText({
      model: resolved.model,
      instructions: profile.personaMd,
      messages: [...history, ...steps.flatMap((s) => s.messages)],
      ...(sdkTools ? { tools: sdkTools } : {}),
      stopWhen: stepCountIs(1),
      maxRetries: MAX_RETRIES,
      abortSignal: AbortSignal.any([signal, wall.signal]),
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          deps.onDelta?.({ runId, profileId: profile.id, stepIdx: idx, text: chunk.text })
        }
      },
      onError: ({ error }) => {
        if (!hadError) {
          hadError = true
          streamError = error
        }
      },
    })

    let finishReason: string
    let stepUsage: Usage
    let responseMessages: readonly ModelMessage[]
    try {
      try {
        await result.consumeStream()
      } catch (err) {
        if (!hadError) {
          hadError = true
          streamError = err
        }
      }
      if (wall.signal.aborted) return fail('budget_wall_clock', usage)
      if (signal.aborted) return interruptedOrSuperseded()
      if (hadError) {
        deps.onFailure?.({
          runId,
          code: toRunErrorCode(streamError),
          errName: errName(streamError),
        })
        return fail(toRunErrorCode(streamError), usage)
      }
      try {
        finishReason = await result.finishReason
        const u = await result.usage
        stepUsage = {
          inputTokens: u.inputTokens ?? 0,
          outputTokens: u.outputTokens ?? 0,
          ...((u.inputTokenDetails.cacheReadTokens ?? 0) > 0
            ? { cachedTokens: u.inputTokenDetails.cacheReadTokens as number }
            : {}),
        }
        responseMessages = await result.responseMessages
      } catch (err) {
        deps.onFailure?.({ runId, code: 'internal_error', errName: errName(err) })
        return fail('internal_error', usage)
      }
      if (finishReason === 'error') {
        deps.onFailure?.({ runId, code: 'internal_error', errName: 'FinishReasonError' })
        return fail('internal_error', usage)
      }
    } finally {
      clearTimeout(timer)
      deps.onStepEnd?.({ runId, profileId: profile.id, stepIdx: idx })
    }

    // Only the assistant message is kept. Tools carry no `execute`, so the SDK runs none; any tool
    // message it made (its own error for an invalid call) is dropped, and every call is answered
    // by the registry instead, wrapped as data.
    const assistantMessages = responseMessages.filter((m) => m.role === 'assistant')
    usage = addUsage(usage, stepUsage)
    const written = await store.appendStep(
      runId,
      {
        idx,
        assistantMessages: [...assistantMessages],
        usage: stepUsage,
        activeMsDelta: takeDelta(),
      },
      usage,
    )
    // Another execution of this run already wrote this step: leave the run to it.
    if (written === 'duplicate') return { outcome: 'interrupted' }
    // Cancel or pause won while the step ran: nothing was written, stop quietly.
    if (written === 'not_running') return { outcome: 'superseded' }

    steps.push({ idx, kind: 'model', messages: [...assistantMessages], usage: stepUsage })
  }

  const ok = await store.succeed(runId, {
    text: finalText(steps),
    usage,
    endedAt: clock.now(),
    activeMsDelta: takeDelta(),
  })
  return ok ? { outcome: 'succeeded' } : { outcome: 'superseded' }
}

/** Client-side tool calls of a model step, in order (provider-executed ones need no answer). */
function toolCallsOf(step: PersistedStep): ToolCallPart[] {
  return step.messages.flatMap((m) =>
    m.role === 'assistant' && typeof m.content !== 'string'
      ? m.content.filter(
          (p): p is ToolCallPart => p.type === 'tool-call' && p.providerExecuted !== true,
        )
      : [],
  )
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown'
}
