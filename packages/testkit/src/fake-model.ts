import { MockLanguageModelV4 } from 'ai/test'

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never
type Usage = GenerateResult['usage']
type FinishReason = GenerateResult['finishReason']['unified']
type Content = GenerateResult['content'][number]

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  /** Input tokens served from cache. `noCache` = input - cacheRead - cacheWrite. */
  cacheReadTokens?: number
  /** Input tokens written to cache. */
  cacheWriteTokens?: number
  /** Part of `outputTokens` spent on reasoning. */
  reasoningTokens?: number
}

export interface ScriptedToolCall {
  name: string
  /** Serialized with JSON.stringify, as the AI SDK expects tool input. */
  input: unknown
}

/**
 * One scripted model call. Provide `text`, `toolCalls`, `reasoning`, or an error.
 * Emission order is reasoning, text, then tool calls.
 *
 * Note on retries: the AI SDK retries a call that rejects with a retryable `APICallError`
 * (`maxRetries`, default 2). Each retry is a new model call and consumes the next scripted
 * turn, so script one `error` turn per expected attempt. Plain `Error`s are never retried.
 */
export interface Turn {
  text?: string
  toolCalls?: ScriptedToolCall[]
  /** Reasoning text, emitted before the text (reasoning parts in stream and generate). */
  reasoning?: string
  /** Defaults to 10 input / 5 output tokens. */
  usage?: TurnUsage
  /** Defaults to `tool-calls` when the turn has tool calls, otherwise `stop`. */
  finishReason?: FinishReason
  /** doGenerate and doStream reject with this error. The call is recorded and consumes the turn. */
  error?: Error
  /** doStream emits an `error` stream part after the text deltas, then finishes with reason `error`. */
  streamError?: Error
}

export interface FakeModelOptions {
  /** Characters (code points) per streamed text/reasoning delta. Default 4. */
  chunkSize?: number
  /** Delay between streamed parts. Default: none, and no timers are used. */
  chunkDelayMs?: number
  provider?: string
  modelId?: string
}

export interface RecordedCall {
  kind: 'generate' | 'stream'
  prompt: CallOptions['prompt']
  tools: CallOptions['tools']
  options: CallOptions
}

export interface FakeModelExtras {
  /** Every call the model received, in order. */
  readonly calls: RecordedCall[]
  /** Scripted turns not yet consumed. */
  readonly remaining: number
}

export type FakeModel = MockLanguageModelV4 & FakeModelExtras

const DEFAULT_USAGE: TurnUsage = { inputTokens: 10, outputTokens: 5 }

function toUsage(u: TurnUsage, turnNo: number): Usage {
  const cacheRead = u.cacheReadTokens ?? 0
  const cacheWrite = u.cacheWriteTokens ?? 0
  const reasoning = u.reasoningTokens ?? 0
  if (cacheRead + cacheWrite > u.inputTokens) {
    throw new Error(
      `fakeModel: turn #${turnNo} usage: cacheReadTokens + cacheWriteTokens exceeds inputTokens`,
    )
  }
  if (reasoning > u.outputTokens) {
    throw new Error(`fakeModel: turn #${turnNo} usage: reasoningTokens exceeds outputTokens`)
  }
  return {
    inputTokens: {
      total: u.inputTokens,
      noCache: u.inputTokens - cacheRead - cacheWrite,
      cacheRead,
      cacheWrite,
    },
    outputTokens: { total: u.outputTokens, text: u.outputTokens - reasoning, reasoning },
  }
}

function chunkText(text: string, size: number): string[] {
  const points = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < points.length; i += size) chunks.push(points.slice(i, i + size).join(''))
  return chunks
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

/** Pull-based stream: emits one part per read, optionally delayed, and errors on abort. */
function partsStream(
  parts: StreamPart[],
  delayMs: number | undefined,
  signal: AbortSignal | undefined,
): ReadableStream<StreamPart> {
  let i = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let wake: (() => void) | undefined
  let onAbort: (() => void) | undefined
  const cleanup = () => {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }
  return new ReadableStream<StreamPart>({
    start(controller) {
      if (!signal) return
      onAbort = () => {
        cleanup()
        wake?.()
        controller.error(abortError(signal))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    },
    async pull(controller) {
      if (signal?.aborted) return
      if (i > 0 && delayMs) {
        await new Promise<void>((resolve) => {
          wake = resolve
          timer = setTimeout(resolve, delayMs)
        })
        wake = undefined
        if (signal?.aborted) return
      }
      const part = parts[i++]
      if (part) controller.enqueue(part)
      if (i >= parts.length) {
        cleanup()
        controller.close()
      }
    },
    cancel() {
      cleanup()
    },
  })
}

/**
 * A deterministic, scripted language model for the AI SDK (spec v4).
 * Each `Turn` answers exactly one model call, from either `doGenerate` or `doStream`,
 * in order. Tool call ids are `call_1`, `call_2`, ... across the whole script.
 * A call that fails to take a turn (exhausted or invalid script) is neither recorded
 * nor counted, so the reported call number stays correct.
 */
export function fakeModel(script: Turn[], opts: FakeModelOptions = {}): FakeModel {
  const chunkSize = opts.chunkSize ?? 4
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('fakeModel: chunkSize must be a positive integer')
  }
  const calls: RecordedCall[] = []
  let used = 0
  let toolCallNo = 0

  const take = (kind: RecordedCall['kind'], options: CallOptions) => {
    options.abortSignal?.throwIfAborted()
    const turnNo = used + 1
    const turn = script[used]
    if (!turn) throw new Error(`fakeModel: no scripted turn left (call #${turnNo})`)
    const hasOutput =
      turn.text !== undefined ||
      turn.reasoning !== undefined ||
      Boolean(turn.toolCalls?.length) ||
      turn.error !== undefined ||
      turn.streamError !== undefined
    if (!hasOutput) {
      throw new Error(`fakeModel: turn #${turnNo} has neither text, reasoning nor toolCalls`)
    }
    const usage = toUsage(turn.usage ?? DEFAULT_USAGE, turnNo)
    used++
    calls.push({ kind, prompt: options.prompt, tools: options.tools, options })
    const toolCalls = (turn.toolCalls ?? []).map((tc) => ({
      type: 'tool-call' as const,
      toolCallId: `call_${++toolCallNo}`,
      toolName: tc.name,
      input: JSON.stringify(tc.input),
    }))
    const unified: FinishReason =
      turn.finishReason ??
      (turn.streamError ? 'error' : toolCalls.length > 0 ? 'tool-calls' : 'stop')
    return {
      turnNo,
      text: turn.text,
      reasoning: turn.reasoning,
      error: turn.error,
      streamError: turn.streamError,
      toolCalls,
      finishReason: { unified, raw: unified },
      usage,
    }
  }

  const model = new MockLanguageModelV4({
    provider: opts.provider ?? 'faire-fake',
    modelId: opts.modelId ?? 'fake-model',
    doGenerate: async (options) => {
      const t = take('generate', options)
      if (t.error) throw t.error
      const content: Content[] = []
      if (t.reasoning !== undefined) content.push({ type: 'reasoning', text: t.reasoning })
      if (t.text !== undefined) content.push({ type: 'text', text: t.text })
      content.push(...t.toolCalls)
      return { content, finishReason: t.finishReason, usage: t.usage, warnings: [] }
    },
    doStream: async (options) => {
      const t = take('stream', options)
      if (t.error) throw t.error
      const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }]
      if (t.reasoning !== undefined) {
        const id = `reasoning_${t.turnNo}`
        parts.push({ type: 'reasoning-start', id })
        for (const delta of chunkText(t.reasoning, chunkSize)) {
          parts.push({ type: 'reasoning-delta', id, delta })
        }
        parts.push({ type: 'reasoning-end', id })
      }
      if (t.text !== undefined) {
        const id = `text_${t.turnNo}`
        parts.push({ type: 'text-start', id })
        for (const delta of chunkText(t.text, chunkSize)) {
          parts.push({ type: 'text-delta', id, delta })
        }
        parts.push({ type: 'text-end', id })
      }
      parts.push(...t.toolCalls)
      if (t.streamError) parts.push({ type: 'error', error: t.streamError })
      parts.push({ type: 'finish', finishReason: t.finishReason, usage: t.usage })
      return { stream: partsStream(parts, opts.chunkDelayMs, options.abortSignal) }
    },
  })

  return Object.defineProperties(model, {
    calls: { value: calls, enumerable: true },
    remaining: { get: () => Math.max(0, script.length - used), enumerable: true },
  }) as FakeModel
}
