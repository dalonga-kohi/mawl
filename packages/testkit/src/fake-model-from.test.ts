import { describe, expect, it } from 'vitest'
import { fakeModelFrom } from './fake-model'

const options = (text: string) => ({
  prompt: [{ role: 'user' as const, content: [{ type: 'text' as const, text }] }],
})

async function streamedText(model: ReturnType<typeof fakeModelFrom>, text: string) {
  const { stream } = await model.doStream(options(text))
  const reader = stream.getReader()
  let out = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return out
    if (value.type === 'text-delta') out += value.delta
  }
}

describe('fakeModelFrom', () => {
  it('answers any number of calls, each turn computed from that call', async () => {
    const model = fakeModelFrom((o) => {
      const last = o.prompt.at(-1)
      const text =
        last?.role === 'user' && last.content[0]?.type === 'text' ? last.content[0].text : ''
      return { text: `Echo: ${text}` }
    })
    expect(await streamedText(model, 'one')).toBe('Echo: one')
    expect(await streamedText(model, 'two')).toBe('Echo: two')
    expect(await streamedText(model, 'three')).toBe('Echo: three')
    expect(model.calls.map((c) => c.kind)).toEqual(['stream', 'stream', 'stream'])
  })

  it('also serves doGenerate and honours chunkSize', async () => {
    const model = fakeModelFrom(() => ({ text: 'abcdef' }), { chunkSize: 3 })
    const res = await model.doGenerate(options('x'))
    expect(res.content).toEqual([{ type: 'text', text: 'abcdef' }])
    const { stream } = await model.doStream(options('x'))
    const deltas: string[] = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value.type === 'text-delta') deltas.push(value.delta)
    }
    expect(deltas).toEqual(['abc', 'def'])
  })
})
