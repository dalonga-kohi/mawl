import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'
import { isContractProcedure } from '@orpc/contract'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { Approval, Device, Profile, Run, Settings } from './entities'
import type { Envelope } from './events'
import { contract } from './router'

function procedurePaths(node: unknown, prefix: string[] = []): string[] {
  if (isContractProcedure(node)) return [prefix.join('.')]
  if (typeof node !== 'object' || node === null) return []
  return Object.entries(node).flatMap(([k, v]) => procedurePaths(v, [...prefix, k]))
}

describe('contract shape', () => {
  it('exposes exactly the planned procedures', () => {
    expect(procedurePaths(contract).sort()).toEqual(
      [
        'health.get',
        'profiles.list',
        'profiles.get',
        'profiles.create',
        'profiles.update',
        'profiles.archive',
        'threads.list',
        'threads.messages',
        'runs.start',
        'runs.get',
        'runs.cancel',
        'runs.pause',
        'runs.resume',
        'approvals.list',
        'approvals.decide',
        'devices.pair',
        'devices.list',
        'devices.revoke',
        'settings.get',
        'settings.update',
        'events.subscribe',
      ].sort(),
    )
  })

  it('declares typed NOT_FOUND and CONFLICT errors on run transitions', () => {
    for (const p of [contract.runs.cancel, contract.runs.pause, contract.runs.resume]) {
      const errors = p['~orpc'].errorMap
      expect(Object.keys(errors)).toEqual(expect.arrayContaining(['NOT_FOUND', 'CONFLICT']))
    }
    expect(Object.keys(contract.runs.get['~orpc'].errorMap)).toContain('NOT_FOUND')
  })
})

describe('contract validation', () => {
  it('validates accent as #rrggbb on settings.update', () => {
    const schema = contract.settings.update['~orpc'].inputSchema
    const parse = (v: unknown) => schema?.['~standard'].validate(v)
    expect(parse({ accent: '#a1b2c3' })).toMatchObject({ value: { accent: '#a1b2c3' } })
    expect(parse({ accent: 'red' })).toHaveProperty('issues')
    expect(parse({ accent: '#abc' })).toHaveProperty('issues')
    expect(parse({ theme: 'sepia' })).toHaveProperty('issues')
  })

  it('streams Envelope events from events.subscribe', () => {
    const out = contract.events.subscribe['~orpc'].outputSchema
    expect(out).toBeDefined()
  })
})

describe('contract types', () => {
  type In = InferContractRouterInputs<typeof contract>
  type Out = InferContractRouterOutputs<typeof contract>

  it('infers procedure outputs from the entity schemas', () => {
    expectTypeOf<Out['runs']['get']>().toEqualTypeOf<z.infer<typeof Run>>()
    expectTypeOf<Out['profiles']['get']>().toEqualTypeOf<z.infer<typeof Profile>>()
    expectTypeOf<Out['profiles']['list']>().toEqualTypeOf<z.infer<typeof Profile>[]>()
    expectTypeOf<Out['approvals']['decide']>().toEqualTypeOf<z.infer<typeof Approval>>()
    expectTypeOf<Out['devices']['pair']>().toEqualTypeOf<z.infer<typeof Device>>()
    expectTypeOf<Out['settings']['get']>().toEqualTypeOf<Settings>()
  })

  it('infers procedure inputs', () => {
    expectTypeOf<In['runs']['cancel']>().toEqualTypeOf<{ id: z.input<typeof Run>['id'] }>()
    expectTypeOf<In['settings']['update']['accent']>().toEqualTypeOf<string | undefined>()
  })

  it('types the event stream as an iterator of Envelope', () => {
    type Stream = Out['events']['subscribe']
    expectTypeOf<Stream extends AsyncIterable<infer E> ? E : never>().toEqualTypeOf<
      z.infer<typeof Envelope>
    >()
  })
})
