import { generateText, stepCountIs, streamText, ToolLoopAgent, tool } from 'ai'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { fakeModel } from './fake-model'

function setup() {
  const executed: Array<{ city: string }> = []
  const weather = tool({
    description: 'Get the weather for a city',
    inputSchema: z.object({ city: z.string() }),
    execute: async (input) => {
      executed.push(input)
      return { city: input.city, tempC: 21 }
    },
  })
  const model = fakeModel([
    {
      toolCalls: [{ name: 'weather', input: { city: 'Warsaw' } }],
      usage: { inputTokens: 12, outputTokens: 3 },
    },
    { text: 'It is 21C in Warsaw.', usage: { inputTokens: 20, outputTokens: 8 } },
  ])
  return { executed, weather, model }
}

describe('fakeModel with the real AI SDK', () => {
  it('generateText runs a tool call then returns the final text', async () => {
    const { executed, weather, model } = setup()
    const result = await generateText({
      model,
      prompt: 'Weather in Warsaw?',
      tools: { weather },
      stopWhen: stepCountIs(3),
    })
    expect(executed).toEqual([{ city: 'Warsaw' }])
    expect(result.text).toBe('It is 21C in Warsaw.')
    expect(result.steps).toHaveLength(2)
    expect(result.totalUsage.inputTokens).toBe(32)
    expect(result.totalUsage.outputTokens).toBe(11)
    expect(model.calls).toHaveLength(2)
    expect(model.calls[0]?.tools?.map((t) => t.name)).toEqual(['weather'])
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain('"tempC":21')
  })

  it('streamText streams the tool call then the final text in chunks', async () => {
    const { executed, weather, model } = setup()
    const result = streamText({
      model,
      prompt: 'Weather in Warsaw?',
      tools: { weather },
      stopWhen: stepCountIs(3),
    })
    const deltas: string[] = []
    for await (const delta of result.textStream) deltas.push(delta)
    expect(deltas).toEqual(['It i', 's 21', 'C in', ' War', 'saw.'])
    expect(executed).toEqual([{ city: 'Warsaw' }])
    expect(await result.text).toBe('It is 21C in Warsaw.')
    expect(await result.steps).toHaveLength(2)
    const usage = await result.totalUsage
    expect(usage.inputTokens).toBe(32)
    expect(usage.outputTokens).toBe(11)
  })

  it('mixes generate and stream calls from one script', async () => {
    const model = fakeModel([{ text: 'first' }, { text: 'second' }])
    const first = await generateText({ model, prompt: 'a' })
    const second = streamText({ model, prompt: 'b' })
    expect(first.text).toBe('first')
    expect(await second.text).toBe('second')
  })

  it('drives a ToolLoopAgent through a tool call to a final answer', async () => {
    const { executed, weather, model } = setup()
    const agent = new ToolLoopAgent({ model, tools: { weather }, stopWhen: stepCountIs(3) })
    const result = await agent.generate({ prompt: 'Weather in Warsaw?' })
    expect(executed).toEqual([{ city: 'Warsaw' }])
    expect(result.text).toBe('It is 21C in Warsaw.')
    expect(result.steps).toHaveLength(2)
  })

  it('pauses a tool that needs approval instead of executing it', async () => {
    const { executed, model } = setup()
    const guarded = tool({
      inputSchema: z.object({ city: z.string() }),
      needsApproval: true,
      execute: async (input) => {
        executed.push(input)
        return 'ok'
      },
    })
    const result = await generateText({
      model,
      prompt: 'Weather in Warsaw?',
      tools: { weather: guarded },
      stopWhen: stepCountIs(3),
    })
    expect(executed).toEqual([])
    expect(result.content.map((p) => p.type)).toContain('tool-approval-request')
  })
})
