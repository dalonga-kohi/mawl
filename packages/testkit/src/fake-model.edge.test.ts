import { generateText, stepCountIs, streamText, ToolLoopAgent, tool } from 'ai'
import type { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fakeModel } from './fake-model'

type GenerateOptions = Parameters<MockLanguageModelV4['doGenerate']>[0]

const options = (): GenerateOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
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

const deltasOf = (parts: Array<{ type: string; delta?: string }>) =>
  parts.flatMap((p) => (p.type === 'text-delta' && p.delta !== undefined ? [p.delta] : []))

const echo = tool({
  inputSchema: z.object({ n: z.number() }),
  execute: async ({ n }) => ({ n }),
})

describe('fakeModel edge cases: unicode chunking', () => {
  const text = 'a😀é👨‍👩‍👧中b'
  const points = Array.from(text)

  it('keeps every code point intact at chunkSize 1', async () => {
    const model = fakeModel([{ text }], { chunkSize: 1 })
    const { stream } = await model.doStream(options())
    const deltas = deltasOf(await collect(stream))
    expect(deltas).toEqual(points)
    for (const d of deltas) expect(d).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/)
  })

  it('emits a single delta for a chunkSize larger than the text', async () => {
    const model = fakeModel([{ text }], { chunkSize: 10_000 })
    const { stream } = await model.doStream(options())
    expect(deltasOf(await collect(stream))).toEqual([text])
  })

  it('round-trips the text through streamText for every chunk size', async () => {
    for (const chunkSize of [1, 2, 3, 100]) {
      const model = fakeModel([{ text }], { chunkSize })
      expect(await streamText({ model, prompt: 'x' }).text).toBe(text)
    }
  })
})

describe('fakeModel edge cases: empty text', () => {
  it('generate and stream agree on an empty-string text turn', async () => {
    const g = await fakeModel([{ text: '' }]).doGenerate(options())
    const s = await collect((await fakeModel([{ text: '' }]).doStream(options())).stream)
    const generateHasText = g.content.some((c) => c.type === 'text')
    const streamHasText = s.some((p) => p.type === 'text-start')
    expect(streamHasText).toBe(generateHasText)
  })

  it('an empty text turn yields an empty result.text via the SDK', async () => {
    const model = fakeModel([{ text: '' }])
    const result = await generateText({ model, prompt: 'x' })
    expect(result.text).toBe('')
    expect(result.finishReason).toBe('stop')
  })
})

describe('fakeModel edge cases: parallel tool calls', () => {
  it('runs several tool calls from one turn and keeps ids unique across turns', async () => {
    const model = fakeModel([
      {
        toolCalls: [
          { name: 'echo', input: { n: 1 } },
          { name: 'echo', input: { n: 2 } },
          { name: 'echo', input: { n: 3 } },
        ],
      },
      { toolCalls: [{ name: 'echo', input: { n: 4 } }] },
      { text: 'done' },
    ])
    const result = await generateText({
      model,
      prompt: 'x',
      tools: { echo },
      stopWhen: stepCountIs(5),
    })
    const ids = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolCallId))
    expect(ids).toEqual(['call_1', 'call_2', 'call_3', 'call_4'])
    const outputs = result.steps.flatMap((s) => s.toolResults.map((r) => r.output))
    expect(outputs).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }])
    expect(result.text).toBe('done')
  })

  it('numbers ids the same way for a streamed parallel turn', async () => {
    const model = fakeModel([
      {
        toolCalls: [
          { name: 'echo', input: { n: 1 } },
          { name: 'echo', input: { n: 2 } },
        ],
      },
      { text: 'ok' },
    ])
    const result = streamText({ model, prompt: 'x', tools: { echo }, stopWhen: stepCountIs(3) })
    const steps = await result.steps
    expect(steps[0]?.toolCalls.map((c) => c.toolCallId)).toEqual(['call_1', 'call_2'])
  })
})

describe('fakeModel edge cases: abort', () => {
  it('streamText aborted mid-stream settles without hanging', async () => {
    const controller = new AbortController()
    const model = fakeModel(
      [{ toolCalls: [{ name: 'echo', input: { n: 1 } }] }, { text: 'abcdefghijklmnop' }],
      { chunkSize: 1 },
    )
    let seen = 0
    const result = streamText({
      model,
      prompt: 'x',
      tools: { echo },
      stopWhen: stepCountIs(3),
      abortSignal: controller.signal,
      onError: () => {},
    })
    const consume = (async () => {
      try {
        for await (const _ of result.textStream) {
          if (++seen === 3) controller.abort()
        }
      } catch {
        // an abort error is acceptable
      }
    })()
    await expect(
      Promise.race([
        consume.then(() => 'settled'),
        new Promise((r) => setTimeout(() => r('hung'), 3000)),
      ]),
    ).resolves.toBe('settled')
    expect(seen).toBeLessThan(16)
  })

  it('an already-aborted signal makes doStream reject or end early rather than hang', async () => {
    const controller = new AbortController()
    controller.abort()
    const model = fakeModel([{ text: 'hello there' }])
    const outcome = await Promise.race([
      model
        .doStream({ ...options(), abortSignal: controller.signal })
        .then(({ stream }) => collect(stream))
        .then(
          () => 'ended',
          () => 'rejected',
        ),
      new Promise((r) => setTimeout(() => r('hung'), 3000)),
    ])
    expect(['ended', 'rejected']).toContain(outcome)
  })
})

describe('fakeModel edge cases: recorded calls', () => {
  it('records tools and the previous step tool results in the next prompt', async () => {
    const model = fakeModel([{ toolCalls: [{ name: 'echo', input: { n: 7 } }] }, { text: 'fin' }])
    await generateText({ model, prompt: 'go', tools: { echo }, stopWhen: stepCountIs(3) })
    expect(model.calls).toHaveLength(2)
    for (const c of model.calls) expect(c.tools?.map((t) => t.name)).toEqual(['echo'])
    const second = model.calls[1]?.prompt ?? []
    const roles = second.map((m) => m.role)
    expect(roles).toEqual(['user', 'assistant', 'tool'])
    const toolMsg = second.find((m) => m.role === 'tool')
    expect(JSON.stringify(toolMsg)).toContain('call_1')
    expect(JSON.stringify(toolMsg)).toContain('"n":7')
  })
})

describe('fakeModel edge cases: exhausted script in an agent', () => {
  it('ToolLoopAgent surfaces the exhausted-script error instead of hanging', async () => {
    const model = fakeModel([{ toolCalls: [{ name: 'echo', input: { n: 1 } }] }])
    const agent = new ToolLoopAgent({ model, tools: { echo }, stopWhen: stepCountIs(5) })
    const outcome = await Promise.race([
      agent.generate({ prompt: 'x' }).then(
        () => new Error('resolved unexpectedly'),
        (e: unknown) => e,
      ),
      new Promise<string>((r) => setTimeout(() => r('hung'), 3000)),
    ])
    expect(outcome).not.toBe('hung')
    expect(String((outcome as Error).message)).toMatch(/no scripted turn left \(call #2\)/)
  })
})

describe('fakeModel edge cases: isolation', () => {
  it('each fakeModel() call has independent script position, calls and ids', async () => {
    const script = [{ toolCalls: [{ name: 'a', input: {} }] }, { text: 'x' }]
    const m1 = fakeModel(script)
    const m2 = fakeModel(script)
    await m1.doGenerate(options())
    expect(m1.remaining).toBe(1)
    expect(m2.remaining).toBe(2)
    expect(m2.calls).toHaveLength(0)
    const res = await m2.doGenerate(options())
    expect(res.content).toContainEqual(expect.objectContaining({ toolCallId: 'call_1' }))
  })

  it('does not mutate the caller script array', async () => {
    const script = [{ text: 'a' }, { text: 'b' }]
    const model = fakeModel(script)
    await model.doGenerate(options())
    await model.doGenerate(options())
    expect(script).toEqual([{ text: 'a' }, { text: 'b' }])
  })
})
