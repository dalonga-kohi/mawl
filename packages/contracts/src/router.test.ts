import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'
import { isContractProcedure } from '@orpc/contract'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { Approval, Device, Profile, Run, Settings } from './entities'
import type { LenientEnvelope } from './events'
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
        'providers.catalog',
        'providers.list',
        'providers.create',
        'providers.delete',
        'providers.test',
        'providers.chatgpt.start',
        'providers.chatgpt.status',
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

describe('base errors', () => {
  it('every procedure declares UNAUTHORIZED, FORBIDDEN and VALIDATION', () => {
    const walk = (n: unknown): void => {
      if (isContractProcedure(n)) {
        expect(Object.keys(n['~orpc'].errorMap)).toEqual(
          expect.arrayContaining(['UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION']),
        )
      } else if (typeof n === 'object' && n !== null) Object.values(n).forEach(walk)
    }
    walk(contract)
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

  describe('profiles input rules', () => {
    const CRED = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8'
    const PROFILE = 'prof_01HZX3K9V2M4N6P8Q0R2S4T6V8'
    const check = async (proc: { '~orpc': { inputSchema?: unknown } }, value: unknown) => {
      const schema = proc['~orpc'].inputSchema as {
        '~standard': { validate(v: unknown): unknown }
      }
      return (await schema['~standard'].validate(value)) as { issues?: unknown[] }
    }

    it('create needs only a name and a model; everything else is optional', async () => {
      const ok = await check(contract.profiles.create, {
        name: 'Ada',
        modelMain: `${CRED}:fake-echo`,
      })
      expect(ok.issues).toBeUndefined()
      expect((await check(contract.profiles.create, { name: 'Ada' })).issues).toBeDefined()
      expect(
        (await check(contract.profiles.create, { modelMain: `${CRED}:m` })).issues,
      ).toBeDefined()
    })

    it('create rejects a model that is not <credentialId>:<modelId>', async () => {
      for (const modelMain of ['gpt-4o', 'openai:gpt-4o', `${CRED}:`]) {
        const res = await check(contract.profiles.create, { name: 'Ada', modelMain })
        expect(res.issues, modelMain).toBeDefined()
      }
      const helper = await check(contract.profiles.create, {
        name: 'Ada',
        modelMain: `${CRED}:m`,
        modelHelper: 'nope',
      })
      expect(helper.issues).toBeDefined()
    })

    it('update rejects a malformed model in the patch but accepts clearing the helper', async () => {
      const bad = await check(contract.profiles.update, {
        id: PROFILE,
        patch: { modelMain: 'nope' },
      })
      expect(bad.issues).toBeDefined()
      const clear = await check(contract.profiles.update, {
        id: PROFILE,
        patch: { modelHelper: null },
      })
      expect(clear.issues).toBeUndefined()
    })

    it('caps persona at 8000 characters on create and update', async () => {
      const base = { name: 'Ada', modelMain: `${CRED}:m` }
      expect(
        (await check(contract.profiles.create, { ...base, personaMd: 'x'.repeat(8000) })).issues,
      ).toBeUndefined()
      expect(
        (await check(contract.profiles.create, { ...base, personaMd: 'x'.repeat(8001) })).issues,
      ).toBeDefined()
      const patch = (personaMd: string) => ({ id: PROFILE, patch: { personaMd } })
      expect(
        (await check(contract.profiles.update, patch('x'.repeat(8000)))).issues,
      ).toBeUndefined()
      expect((await check(contract.profiles.update, patch('x'.repeat(8001)))).issues).toBeDefined()
    })

    it('caps an explicit slug at 40 characters', async () => {
      const base = { name: 'Ada', modelMain: `${CRED}:m` }
      expect(
        (await check(contract.profiles.create, { ...base, slug: 'a'.repeat(40) })).issues,
      ).toBeUndefined()
      expect(
        (await check(contract.profiles.create, { ...base, slug: 'a'.repeat(41) })).issues,
      ).toBeDefined()
      const patch = (slug: string) => ({ id: PROFILE, patch: { slug } })
      expect((await check(contract.profiles.update, patch('a'.repeat(41)))).issues).toBeDefined()
    })

    it('trims the name and rejects a blank one', async () => {
      const base = { modelMain: `${CRED}:m` }
      expect((await check(contract.profiles.create, { ...base, name: '   ' })).issues).toBeDefined()
      const ok = await check(contract.profiles.create, { ...base, name: '  Ada  ' })
      expect(ok).toMatchObject({ value: { name: 'Ada' } })
      expect(
        (await check(contract.profiles.update, { id: PROFILE, patch: { name: '  ' } })).issues,
      ).toBeDefined()
    })

    it('declares SLUG_TAKEN and UNKNOWN_CREDENTIAL on create and update', () => {
      for (const p of [contract.profiles.create, contract.profiles.update]) {
        const errors = p['~orpc'].errorMap
        expect(errors.SLUG_TAKEN).toMatchObject({ status: 409 })
        expect(errors.UNKNOWN_CREDENTIAL).toMatchObject({ status: 422 })
      }
      expect(Object.keys(contract.profiles.update['~orpc'].errorMap)).toContain('NOT_FOUND')
    })
  })

  it('streams Envelope events from events.subscribe', () => {
    const out = contract.events.subscribe['~orpc'].outputSchema
    expect(out).toBeDefined()
  })

  it('declares RESYNC_REQUIRED and TOO_MANY_SUBSCRIPTIONS on events.subscribe', () => {
    const errors = contract.events.subscribe['~orpc'].errorMap
    expect(errors.RESYNC_REQUIRED).toMatchObject({ status: 409 })
    expect(errors.TOO_MANY_SUBSCRIPTIONS).toMatchObject({ status: 429 })
  })

  it('limits one subscription to 50 topics', async () => {
    const schema = contract.events.subscribe['~orpc'].inputSchema
    const topic = 'profile:*'
    const validate = (n: number) =>
      schema?.['~standard'].validate({ topics: Array.from({ length: n }, () => topic) })
    expect(await validate(50)).not.toHaveProperty('issues')
    expect(await validate(51)).toHaveProperty('issues')
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
    expectTypeOf<Out['devices']['pair']['device']>().toEqualTypeOf<z.infer<typeof Device>>()
    expectTypeOf<Out['devices']['pair']['session']['token']>().toEqualTypeOf<string>()
    expectTypeOf<Out['settings']['get']>().toEqualTypeOf<Settings>()
  })

  it('infers procedure inputs', () => {
    expectTypeOf<In['runs']['cancel']>().toEqualTypeOf<{ id: z.input<typeof Run>['id'] }>()
    expectTypeOf<In['settings']['update']['accent']>().toEqualTypeOf<string | undefined>()
  })

  it('types the event stream as an iterator of LenientEnvelope', () => {
    type Stream = Out['events']['subscribe']
    expectTypeOf<Stream extends AsyncIterable<infer E> ? E : never>().toEqualTypeOf<
      z.infer<typeof LenientEnvelope>
    >()
  })
})
