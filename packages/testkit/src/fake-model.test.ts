import type { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { fakeModel } from './fake-model'

type GenerateOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

const options = (text = 'hi'): GenerateOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text }] }],
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

describe('fakeModel doGenerate', () => {
  it('returns scripted text with default stop reason and usage', async () => {
    const model = fakeModel([{ text: 'hello' }])
    const res = await model.doGenerate(options())
    expect(res.content).toEqual([{ type: 'text', text: 'hello' }])
    expect(res.finishReason).toEqual({ unified: 'stop', raw: 'stop' })
    expect(res.usage.inputTokens.total).toBe(10)
    expect(res.usage.outputTokens.total).toBe(5)
  })

  it('returns tool calls with deterministic ids and JSON-encoded input', async () => {
    const model = fakeModel([
      {
        toolCalls: [
          { name: 'a', input: { x: 1 } },
          { name: 'b', input: {} },
        ],
      },
      { toolCalls: [{ name: 'c', input: 'str' }] },
    ])
    const first = await model.doGenerate(options())
    expect(first.content).toEqual([
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'a', input: '{"x":1}' },
      { type: 'tool-call', toolCallId: 'call_2', toolName: 'b', input: '{}' },
    ])
    expect(first.finishReason.unified).toBe('tool-calls')
    const second = await model.doGenerate(options())
    expect(second.content).toEqual([
      { type: 'tool-call', toolCallId: 'call_3', toolName: 'c', input: '"str"' },
    ])
  })

  it('puts optional text before tool calls', async () => {
    const model = fakeModel([{ text: 'checking', toolCalls: [{ name: 'a', input: {} }] }])
    const res = await model.doGenerate(options())
    expect(res.content.map((c) => c.type)).toEqual(['text', 'tool-call'])
  })

  it('honours custom usage and finishReason', async () => {
    const model = fakeModel([
      { text: 'cut', usage: { inputTokens: 100, outputTokens: 7 }, finishReason: 'length' },
    ])
    const res = await model.doGenerate(options())
    expect(res.finishReason.unified).toBe('length')
    expect(res.usage.inputTokens.total).toBe(100)
    expect(res.usage.outputTokens.total).toBe(7)
  })

  it('throws a clear error once the script is exhausted', async () => {
    const model = fakeModel([{ text: 'only' }])
    await model.doGenerate(options())
    await expect(model.doGenerate(options())).rejects.toThrow(
      'fakeModel: no scripted turn left (call #2)',
    )
  })

  it('rejects a turn that has neither text nor tool calls', async () => {
    const model = fakeModel([{}])
    await expect(model.doGenerate(options())).rejects.toThrow(/turn #1/)
  })
})

describe('fakeModel doStream', () => {
  it('splits text into 4-char chunks by default, framed by stream-start and finish', async () => {
    const model = fakeModel([{ text: 'abcdefghij' }])
    const { stream } = await model.doStream(options())
    const parts = await collect(stream)
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ])
    const deltas = parts.flatMap((p) => (p.type === 'text-delta' ? [p.delta] : []))
    expect(deltas).toEqual(['abcd', 'efgh', 'ij'])
    const finish = parts.at(-1)
    expect(finish).toMatchObject({
      type: 'finish',
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 5 } },
    })
  })

  it('respects a configured chunk size', async () => {
    const model = fakeModel([{ text: 'abcdef' }], { chunkSize: 2 })
    const { stream } = await model.doStream(options())
    const deltas = (await collect(stream)).flatMap((p) =>
      p.type === 'text-delta' ? [p.delta] : [],
    )
    expect(deltas).toEqual(['ab', 'cd', 'ef'])
  })

  it('does not split surrogate pairs', async () => {
    const model = fakeModel([{ text: 'a😀b' }], { chunkSize: 2 })
    const { stream } = await model.doStream(options())
    const deltas = (await collect(stream)).flatMap((p) =>
      p.type === 'text-delta' ? [p.delta] : [],
    )
    expect(deltas).toEqual(['a😀', 'b'])
  })

  it('streams tool calls with the same ids as generate would use', async () => {
    const model = fakeModel([{ toolCalls: [{ name: 'a', input: { x: 1 } }] }])
    const { stream } = await model.doStream(options())
    const parts = await collect(stream)
    expect(parts).toContainEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'a',
      input: '{"x":1}',
    })
    expect(parts.at(-1)).toMatchObject({ finishReason: { unified: 'tool-calls' } })
  })

  it('shares one ordered script between generate and stream', async () => {
    const model = fakeModel([{ text: 'one' }, { text: 'two' }])
    await model.doGenerate(options())
    const { stream } = await model.doStream(options())
    const text = (await collect(stream)).flatMap((p) => (p.type === 'text-delta' ? [p.delta] : []))
    expect(text.join('')).toBe('two')
  })

  it('throws a clear error once the script is exhausted', async () => {
    const model = fakeModel([])
    await expect(model.doStream(options())).rejects.toThrow(
      'fakeModel: no scripted turn left (call #1)',
    )
  })

  it('emits no text parts for a tool-call-only turn', async () => {
    const model = fakeModel([{ toolCalls: [{ name: 'a', input: {} }] }])
    const { stream } = await model.doStream(options())
    const types = (await collect(stream)).map((p) => p.type)
    expect(types).not.toContain('text-start')
  })
})

describe('fakeModel recorded calls', () => {
  it('records prompts and tools for each call, in order', async () => {
    const model = fakeModel([{ text: 'a' }, { text: 'b' }])
    await model.doGenerate({
      ...options('first'),
      tools: [
        {
          type: 'function',
          name: 'lookup',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })
    await model.doStream(options('second'))
    expect(model.calls).toHaveLength(2)
    expect(model.calls[0]?.kind).toBe('generate')
    expect(model.calls[0]?.tools?.map((t) => t.name)).toEqual(['lookup'])
    expect(model.calls[1]?.kind).toBe('stream')
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain('second')
  })

  it('reports how many scripted turns remain', async () => {
    const model = fakeModel([{ text: 'a' }, { text: 'b' }])
    expect(model.remaining).toBe(2)
    await model.doGenerate(options())
    expect(model.remaining).toBe(1)
  })
})
