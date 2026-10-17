import { APICallError, generateText, streamText } from 'ai'
import type { MockLanguageModelV4 } from 'ai/test'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { fakeModel } from './fake-model'

type GenerateOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

const options = (extra: Partial<GenerateOptions> = {}): GenerateOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  ...extra,
})

async function collect<T>(stream: ReadableStream<T>): Promise<T[]> {
  const out: T[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return out
    out.push(value)
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('fakeModel empty text', () => {
  it('streams text-start and text-end (no deltas) for an empty-string turn, like generate', async () => {
    const { stream } = await fakeModel([{ text: '' }]).doStream(options())
    const types = (await collect(stream)).map((p) => p.type)
    expect(types).toEqual(['stream-start', 'text-start', 'text-end', 'finish'])
    const g = await fakeModel([{ text: '' }]).doGenerate(options())
    expect(g.content).toEqual([{ type: 'text', text: '' }])
  })
})

describe('fakeModel usage details', () => {
  it('maps cache and reasoning tokens and derives noCache', async () => {
    const model = fakeModel([
      {
        text: 'x',
        usage: {
          inputTokens: 100,
          outputTokens: 30,
          cacheReadTokens: 60,
          cacheWriteTokens: 15,
          reasoningTokens: 10,
        },
      },
    ])
    const { usage } = await model.doGenerate(options())
    expect(usage.inputTokens).toEqual({ total: 100, noCache: 25, cacheRead: 60, cacheWrite: 15 })
    expect(usage.outputTokens).toEqual({ total: 30, text: 20, reasoning: 10 })
  })

  it('rejects cache tokens that exceed the input total', async () => {
    const model = fakeModel([
      {
        text: 'x',
        usage: { inputTokens: 10, outputTokens: 1, cacheReadTokens: 8, cacheWriteTokens: 5 },
      },
    ])
    await expect(model.doGenerate(options())).rejects.toThrow(/cacheReadTokens \+ cacheWriteTokens/)
  })

  it('rejects reasoning tokens that exceed the output total', async () => {
    const model = fakeModel([
      { text: 'x', usage: { inputTokens: 1, outputTokens: 2, reasoningTokens: 3 } },
    ])
    await expect(model.doGenerate(options())).rejects.toThrow(/reasoningTokens/)
  })

  it('sums cache usage through the SDK', async () => {
    const model = fakeModel([
      { text: 'x', usage: { inputTokens: 50, outputTokens: 5, cacheReadTokens: 40 } },
    ])
    const result = await generateText({ model, prompt: 'x' })
    expect(result.totalUsage.inputTokenDetails.cacheReadTokens).toBe(40)
    expect(result.totalUsage.inputTokenDetails.noCacheTokens).toBe(10)
  })
})

describe('fakeModel error turns', () => {
  it('rejects doGenerate and doStream with the scripted error, and records the call', async () => {
    const boom = new Error('provider exploded')
    const model = fakeModel([{ error: boom }, { error: boom }])
    await expect(model.doGenerate(options())).rejects.toBe(boom)
    await expect(model.doStream(options())).rejects.toBe(boom)
    expect(model.calls.map((c) => c.kind)).toEqual(['generate', 'stream'])
    expect(model.remaining).toBe(0)
  })

  it('SDK retries of a retryable error consume scripted turns', async () => {
    const retryable = new APICallError({
      message: 'overloaded',
      url: 'http://fake',
      requestBodyValues: {},
      isRetryable: true,
      responseHeaders: { 'retry-after-ms': '1' },
    })
    const model = fakeModel([{ error: retryable }, { error: retryable }, { text: 'recovered' }])
    const result = await generateText({ model, prompt: 'x', maxRetries: 2 })
    expect(result.text).toBe('recovered')
    expect(model.calls).toHaveLength(3)
  })

  it('does not retry a plain Error', async () => {
    const model = fakeModel([{ error: new Error('nope') }, { text: 'unused' }])
    await expect(generateText({ model, prompt: 'x' })).rejects.toThrow('nope')
    expect(model.remaining).toBe(1)
  })

  it('emits an error part after the text deltas for streamError', async () => {
    const err = new Error('mid-stream failure')
    const model = fakeModel([{ text: 'abcdefgh', streamError: err }])
    const { stream } = await model.doStream(options())
    const parts = await collect(stream)
    const types = parts.map((p) => p.type)
    expect(types.indexOf('error')).toBeGreaterThan(types.lastIndexOf('text-delta'))
    expect(parts.find((p) => p.type === 'error')).toMatchObject({ error: err })
  })

  it('surfaces a streamError through streamText onError', async () => {
    const err = new Error('mid-stream failure')
    const model = fakeModel([{ text: 'abcdefgh', streamError: err }])
    const errors: unknown[] = []
    const result = streamText({ model, prompt: 'x', onError: ({ error }) => errors.push(error) })
    await result.consumeStream()
    expect(errors).toEqual([err])
  })
})

describe('fakeModel reasoning', () => {
  it('streams reasoning-start/delta/end before the text', async () => {
    const model = fakeModel([{ reasoning: 'thinking', text: 'ok' }], { chunkSize: 4 })
    const { stream } = await model.doStream(options())
    const parts = await collect(stream)
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'reasoning-start',
      'reasoning-delta',
      'reasoning-delta',
      'reasoning-end',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    const deltas = parts.flatMap((p) => (p.type === 'reasoning-delta' ? [p.delta] : []))
    expect(deltas).toEqual(['thin', 'king'])
  })

  it('returns a reasoning content part before the text from doGenerate', async () => {
    const model = fakeModel([{ reasoning: 'thinking', text: 'ok' }])
    const { content } = await model.doGenerate(options())
    expect(content).toEqual([
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'ok' },
    ])
  })

  it('reaches result.reasoningText via generateText and streamText', async () => {
    const g = await generateText({
      model: fakeModel([{ reasoning: 'why', text: 'ok' }]),
      prompt: 'x',
    })
    expect(g.reasoningText).toBe('why')
    const s = streamText({ model: fakeModel([{ reasoning: 'why', text: 'ok' }]), prompt: 'x' })
    expect(await s.reasoningText).toBe('why')
  })
})

describe('fakeModel failed takes', () => {
  it('does not advance the call number or record a call when the script is exhausted', async () => {
    const model = fakeModel([{ text: 'a' }])
    await model.doGenerate(options())
    await expect(model.doGenerate(options())).rejects.toThrow('(call #2)')
    await expect(model.doStream(options())).rejects.toThrow('(call #2)')
    expect(model.calls).toHaveLength(1)
  })

  it('does not advance or record for an invalid turn', async () => {
    const model = fakeModel([{}, { text: 'a' }])
    await expect(model.doGenerate(options())).rejects.toThrow(/turn #1/)
    await expect(model.doGenerate(options())).rejects.toThrow(/turn #1/)
    expect(model.calls).toHaveLength(0)
    expect(model.remaining).toBe(2)
  })
})

describe('fakeModel abort', () => {
  it('rejects doStream when the signal is already aborted, without consuming a turn', async () => {
    const controller = new AbortController()
    controller.abort()
    const model = fakeModel([{ text: 'hello' }])
    await expect(model.doStream(options({ abortSignal: controller.signal }))).rejects.toThrow()
    expect(model.remaining).toBe(1)
    expect(model.calls).toHaveLength(0)
  })

  it('errors the stream when aborted mid-stream and stops emitting', async () => {
    const controller = new AbortController()
    const model = fakeModel([{ text: 'abcdefghij' }], { chunkSize: 1 })
    const { stream } = await model.doStream(options({ abortSignal: controller.signal }))
    const reader = stream.getReader()
    const seen: string[] = []
    for (let i = 0; i < 3; i++) {
      const { value } = await reader.read()
      if (value) seen.push(value.type)
    }
    controller.abort()
    await expect(reader.read()).rejects.toThrow()
    expect(seen).toEqual(['stream-start', 'text-start', 'text-delta'])
  })

  it('aborts promptly while waiting on chunkDelayMs and leaves no timer behind', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const model = fakeModel([{ text: 'abcdefgh' }], { chunkSize: 1, chunkDelayMs: 1000 })
    const { stream } = await model.doStream(options({ abortSignal: controller.signal }))
    const reader = stream.getReader()
    await reader.read()
    const pending = reader.read().then(
      () => 'value',
      () => 'rejected',
    )
    controller.abort()
    expect(await pending).toBe('rejected')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('streams all parts with chunkDelayMs when not aborted', async () => {
    vi.useFakeTimers()
    const model = fakeModel([{ text: 'ab' }], { chunkSize: 1, chunkDelayMs: 50 })
    const { stream } = await model.doStream(options())
    const done = collect(stream)
    await vi.advanceTimersByTimeAsync(1000)
    expect((await done).map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ])
  })
})

describe('fakeModel types', () => {
  it('is assignable to the model parameter of generateText', () => {
    const model = fakeModel([])
    expectTypeOf(model).toExtend<Parameters<typeof generateText>[0]['model']>()
  })
})
