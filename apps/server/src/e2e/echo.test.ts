import { ProviderFailureError, type RunRecord } from '@mawl/core'
import { describe, expect, it } from 'vitest'
import { createEchoResolver, E2E_CREDENTIAL_LABEL, ECHO_MODEL_ID, SLOW_TEXT } from './echo.ts'

const run = { id: 'run_x' } as unknown as RunRecord
const profile = { id: 'prof_x', personaMd: '', modelMain: 'cred_x:fake-echo' } as never

type Streamable = { doStream(o: never): PromiseLike<{ stream: ReadableStream<unknown> }> }

async function deltas(model: unknown, prompt: string, max = Number.POSITIVE_INFINITY) {
  const { stream } = await (model as Streamable).doStream({
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'earlier' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
      { role: 'user', content: [{ type: 'text', text: prompt }] },
    ],
  } as never)
  const reader = stream.getReader()
  const out: string[] = []
  while (out.length < max) {
    const { done, value } = await reader.read()
    if (done) break
    const part = value as { type: string; delta?: string }
    if (part.type === 'text-delta') out.push(part.delta ?? '')
  }
  await reader.cancel()
  return out
}

describe('e2e echo model', () => {
  it('names itself so the production bundle can be checked for it', () => {
    expect(ECHO_MODEL_ID).toBe('mawl-e2e-echo-model')
    expect(E2E_CREDENTIAL_LABEL).toBe('E2E fake model')
  })

  it('echoes the last user message in 3-character chunks, 30 ms apart', async () => {
    const resolve = createEchoResolver(async () => 'hello')
    const { model } = await resolve(run, profile)
    const started = performance.now()
    const parts = await deltas(model, 'hello')
    expect(parts).toEqual(['Ech', 'o: ', 'hel', 'lo'])
    // Three gaps between four deltas (plus the framing parts): at least ~90 ms of pacing.
    expect(performance.now() - started).toBeGreaterThanOrEqual(80)
  })

  it('answers many calls with the same model', async () => {
    const { model } = await createEchoResolver(async () => 'x')(run, profile)
    expect((await deltas(model, 'one')).join('')).toBe('Echo: one')
    expect((await deltas(model, 'two')).join('')).toBe('Echo: two')
    expect((await deltas(model, 'three')).join('')).toBe('Echo: three')
  })

  it('/slow streams a long plain paragraph, 3 characters per delta', async () => {
    expect(SLOW_TEXT.length).toBeGreaterThanOrEqual(550)
    expect(SLOW_TEXT.length).toBeLessThanOrEqual(700)
    expect(SLOW_TEXT).toMatch(/^[A-Za-z. ]+$/)
    const { model } = await createEchoResolver(async () => 'please /slow')(run, profile)
    const parts = await deltas(model, 'please /slow', 4)
    expect(parts).toEqual([
      SLOW_TEXT.slice(0, 3),
      SLOW_TEXT.slice(3, 6),
      SLOW_TEXT.slice(6, 9),
      SLOW_TEXT.slice(9, 12),
    ])
  })

  it('/fail rejects model lookup with a plan_limit_reached provider failure', async () => {
    const resolve = createEchoResolver(async () => 'do it /fail')
    await expect(resolve(run, profile)).rejects.toBeInstanceOf(ProviderFailureError)
    await expect(resolve(run, profile)).rejects.toMatchObject({ reason: 'plan_limit_reached' })
  })

  it('asks for the prompt of the run being resolved', async () => {
    const seen: string[] = []
    const resolve = createEchoResolver(async (r) => {
      seen.push(r.id)
      return 'x'
    })
    await resolve(run, profile)
    expect(seen).toEqual(['run_x'])
  })
})
