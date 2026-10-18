import type { RunErrorCode, Usage } from '@faire/contracts'
import { type ModelMessage, stepCountIs, streamText } from 'ai'
import { toRunErrorCode } from './errors.ts'
import {
  ABORT_SHUTDOWN,
  DEFAULT_RUN_BUDGET,
  type ExecuteRunDeps,
  type PersistedStep,
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

  if (run.status === 'queued') {
    const startedAt = clock.now()
    if (!(await store.transition(runId, 'queued', 'running', { startedAt }))) {
      return { outcome: 'superseded' }
    }
    run = { ...run, status: 'running', startedAt }
  } else if (run.status !== 'running') {
    return { outcome: 'skipped' }
  }
  // A run already `running` here is a crash resume: carry on from the persisted steps.
  const startedAt = run.startedAt ?? clock.now()

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
    })
    return ok ? { outcome: 'failed', error: code } : { outcome: 'superseded' }
  }

  const persisted = await store.steps(runId)
  let usage = sumUsage(persisted)

  let model: Awaited<ReturnType<typeof deps.resolveModel>>
  try {
    model = await deps.resolveModel(run, profile)
  } catch (err) {
    deps.onFailure?.({ runId, code: toRunErrorCode(err), errName: errName(err) })
    return fail(toRunErrorCode(err), usage)
  }

  const history = await store.history(run)
  const steps: PersistedStep[] = [...persisted]
  const tools = deps.supportsTools === false || !hasTools(deps.tools) ? undefined : deps.tools

  for (;;) {
    // The last persisted step is a model step without tool calls: only the finish was missed.
    const last = steps.at(-1)
    if (last?.kind === 'model') break

    if (signal.aborted) return interruptedOrSuperseded()
    const status = await store.status(runId)
    if (status !== 'running') return { outcome: 'superseded' }

    const modelSteps = steps.filter((s) => s.kind === 'model').length
    if (modelSteps >= budget.maxSteps) return fail('budget_steps', usage)
    if (usage.inputTokens + usage.outputTokens >= budget.maxTokens) {
      return fail('budget_tokens', usage)
    }
    const remainingMs = budget.maxWallClockMs - (clock.now().getTime() - startedAt.getTime())
    if (remainingMs <= 0) return fail('budget_wall_clock', usage)

    const idx = last ? last.idx + 1 : 0

    const wall = new AbortController()
    const timer = setTimeout(() => wall.abort(new Error('wall clock')), remainingMs)
    let streamError: unknown
    let hadError = false
    const result = streamText({
      model,
      instructions: profile.personaMd,
      messages: [...history, ...steps.flatMap((s) => s.messages)],
      ...(tools ? { tools } : {}),
      stopWhen: stepCountIs(1),
      maxRetries: MAX_RETRIES,
      abortSignal: AbortSignal.any([signal, wall.signal]),
      onChunk: ({ chunk }) => {
        if (chunk.type === 'text-delta') {
          deps.onDelta?.({ runId, stepIdx: idx, text: chunk.text })
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
    }

    const assistantMessages = responseMessages.filter((m) => m.role === 'assistant')
    const toolMessages = responseMessages.filter((m) => m.role === 'tool')
    usage = addUsage(usage, stepUsage)
    const written = await store.appendStep(
      runId,
      {
        idx,
        assistantMessages: [...assistantMessages],
        toolMessages: toolMessages.length > 0 ? [...toolMessages] : null,
        usage: stepUsage,
      },
      usage,
    )
    // Another execution of this run already wrote this step: leave the run to it.
    if (!written) return { outcome: 'interrupted' }

    steps.push({ idx, kind: 'model', messages: [...assistantMessages], usage: stepUsage })
    if (toolMessages.length > 0) {
      steps.push({ idx: idx + 1, kind: 'tool', messages: [...toolMessages], usage: null })
    }
    // Final unless the model asked for tools and they produced results.
    if (!(finishReason === 'tool-calls' && toolMessages.length > 0)) break
  }

  const ok = await store.succeed(runId, { text: finalText(steps), usage, endedAt: clock.now() })
  return ok ? { outcome: 'succeeded' } : { outcome: 'superseded' }
}

function hasTools(tools: ExecuteRunDeps['tools']): boolean {
  return tools !== undefined && Object.keys(tools).length > 0
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : 'unknown'
}
