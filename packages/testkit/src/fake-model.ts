import { simulateReadableStream } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'

type CallOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]
type GenerateResult = Awaited<ReturnType<MockLanguageModelV4['doGenerate']>>
type StreamPart =
  Awaited<ReturnType<MockLanguageModelV4['doStream']>>['stream'] extends ReadableStream<infer P>
    ? P
    : never
type Usage = GenerateResult['usage']
type FinishReason = GenerateResult['finishReason']['unified']

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
}

export interface ScriptedToolCall {
  name: string
  /** Serialized with JSON.stringify, as the AI SDK expects tool input. */
  input: unknown
}

/** One scripted model call. Provide `text`, `toolCalls` or both (text is emitted first). */
export interface Turn {
  text?: string
  toolCalls?: ScriptedToolCall[]
  /** Defaults to 10 input / 5 output tokens. */
  usage?: TurnUsage
  /** Defaults to `tool-calls` when the turn has tool calls, otherwise `stop`. */
  finishReason?: FinishReason
}

export interface FakeModelOptions {
  /** Characters (code points) per streamed text-delta. Default 4. */
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

function toUsage({ inputTokens, outputTokens }: TurnUsage): Usage {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

function chunkText(text: string, size: number): string[] {
  const points = Array.from(text)
  const chunks: string[] = []
  for (let i = 0; i < points.length; i += size) chunks.push(points.slice(i, i + size).join(''))
  return chunks
}

/**
 * A deterministic, scripted language model for the AI SDK (spec v4).
 * Each `Turn` answers exactly one model call, from either `doGenerate` or `doStream`,
 * in order. Tool call ids are `call_1`, `call_2`, ... across the whole script.
 */
export function fakeModel(script: Turn[], opts: FakeModelOptions = {}): FakeModel {
  const chunkSize = opts.chunkSize ?? 4
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('fakeModel: chunkSize must be a positive integer')
  }
  const calls: RecordedCall[] = []
  let callNo = 0
  let toolCallNo = 0

  const take = (kind: RecordedCall['kind'], options: CallOptions) => {
    callNo++
    const turn = script[callNo - 1]
    if (!turn) throw new Error(`fakeModel: no scripted turn left (call #${callNo})`)
    if (turn.text === undefined && !turn.toolCalls?.length) {
      throw new Error(`fakeModel: turn #${callNo} has neither text nor toolCalls`)
    }
    calls.push({ kind, prompt: options.prompt, tools: options.tools, options })
    const toolCalls = (turn.toolCalls ?? []).map((tc) => ({
      type: 'tool-call' as const,
      toolCallId: `call_${++toolCallNo}`,
      toolName: tc.name,
      input: JSON.stringify(tc.input),
    }))
    const unified: FinishReason =
      turn.finishReason ?? (toolCalls.length > 0 ? 'tool-calls' : 'stop')
    return {
      text: turn.text,
      toolCalls,
      finishReason: { unified, raw: unified },
      usage: toUsage(turn.usage ?? DEFAULT_USAGE),
    }
  }

  const model = new MockLanguageModelV4({
    provider: opts.provider ?? 'faire-fake',
    modelId: opts.modelId ?? 'fake-model',
    doGenerate: async (options) => {
      const t = take('generate', options)
      return {
        content: [
          ...(t.text !== undefined ? [{ type: 'text' as const, text: t.text }] : []),
          ...t.toolCalls,
        ],
        finishReason: t.finishReason,
        usage: t.usage,
        warnings: [],
      }
    },
    doStream: async (options) => {
      const t = take('stream', options)
      const textId = `text_${callNo}`
      const parts: StreamPart[] = [{ type: 'stream-start', warnings: [] }]
      if (t.text) {
        parts.push({ type: 'text-start', id: textId })
        for (const delta of chunkText(t.text, chunkSize)) {
          parts.push({ type: 'text-delta', id: textId, delta })
        }
        parts.push({ type: 'text-end', id: textId })
      }
      parts.push(...t.toolCalls, { type: 'finish', finishReason: t.finishReason, usage: t.usage })
      return {
        stream: simulateReadableStream({
          chunks: parts,
          initialDelayInMs: null,
          chunkDelayInMs: opts.chunkDelayMs ?? null,
        }),
      }
    },
  })

  return Object.defineProperties(model, {
    calls: { value: calls, enumerable: true },
    remaining: { get: () => Math.max(0, script.length - callNo), enumerable: true },
  }) as FakeModel
}
