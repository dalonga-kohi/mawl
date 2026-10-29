import type { InferContractRouterInputs, InferContractRouterOutputs } from '@orpc/contract'
import { isContractProcedure } from '@orpc/contract'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { z } from 'zod'
import type { Approval, Device, Profile, Run, Settings, UserProfile } from './entities'
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
        'runs.reply',
        'search.status',
        'search.setKey',
        'search.clearKey',
        'approvals.list',
        'approvals.get',
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
        'user.get',
        'user.update',
        'events.subscribe',
      ].sort(),
    )
  })

  it('declares typed NOT_FOUND and CONFLICT errors on run transitions', () => {
    for (const p of [
      contract.runs.cancel,
      contract.runs.pause,
      contract.runs.resume,
      contract.runs.reply,
    ]) {
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

  describe('user profile input rules', () => {
    const check = async (value: unknown) =>
      (await contract.user.update['~orpc'].inputSchema?.['~standard'].validate(value)) as {
        value?: unknown
        issues?: unknown[]
      }

    it('trims the name and keeps the personal context as typed', async () => {
      expect(await check({ name: '  Sam  ', personalContext: '  I bake.\n' })).toMatchObject({
        value: { name: 'Sam', personalContext: '  I bake.\n' },
      })
    })

    it('accepts an empty profile (both fields cleared)', async () => {
      expect((await check({ name: '', personalContext: '' })).issues).toBeUndefined()
      expect((await check({ name: '   ', personalContext: '' })).value).toEqual({
        name: '',
        personalContext: '',
      })
    })

    it('caps the name at 80 characters after trimming', async () => {
      expect((await check({ name: 'x'.repeat(80), personalContext: '' })).issues).toBeUndefined()
      expect(
        (await check({ name: ` ${'x'.repeat(80)} `, personalContext: '' })).issues,
      ).toBeUndefined()
      expect((await check({ name: 'x'.repeat(81), personalContext: '' })).issues).toBeDefined()
    })

    it('caps the personal context at 2000 characters', async () => {
      expect((await check({ name: '', personalContext: 'x'.repeat(2000) })).issues).toBeUndefined()
      expect((await check({ name: '', personalContext: 'x'.repeat(2001) })).issues).toBeDefined()
    })

    it('needs both fields, so an update always replaces the whole profile', async () => {
      expect((await check({ name: 'Sam' })).issues).toBeDefined()
      expect((await check({ personalContext: 'x' })).issues).toBeDefined()
      expect((await check({ name: 4, personalContext: '' })).issues).toBeDefined()
    })

    it('rejects unknown keys instead of dropping them', async () => {
      expect(
        (await check({ name: 'Sam', personalContext: '', apiKey: 'sk-live' })).issues,
      ).toBeDefined()
    })

    it('user.get takes no input and returns a strict profile', async () => {
      const out = contract.user.get['~orpc'].outputSchema
      const ok = await out?.['~standard'].validate({ name: 'Sam', personalContext: '' })
      expect(ok).not.toHaveProperty('issues')
      const extra = await out?.['~standard'].validate({ name: 'S', personalContext: '', x: 1 })
      expect(extra).toHaveProperty('issues')
    })
  })

  describe('runs.reply input rules', () => {
    const RUN = 'run_01HZX3K9V2M4N6P8Q0R2S4T6V8'
    const check = async (value: unknown) =>
      (await contract.runs.reply['~orpc'].inputSchema?.['~standard'].validate(value)) as {
        value?: unknown
        issues?: unknown[]
      }

    it('trims the answer and rejects a blank one', async () => {
      expect(await check({ id: RUN, answer: '  yes  ' })).toMatchObject({
        value: { id: RUN, answer: 'yes' },
      })
      expect((await check({ id: RUN, answer: '   ' })).issues).toBeDefined()
    })

    it('caps the answer at 4000 characters and rejects unknown keys', async () => {
      expect((await check({ id: RUN, answer: 'x'.repeat(4000) })).issues).toBeUndefined()
      expect((await check({ id: RUN, answer: 'x'.repeat(4001) })).issues).toBeDefined()
      expect((await check({ id: RUN, answer: 'ok', extra: 1 })).issues).toBeDefined()
    })
  })

  describe('search key procedures', () => {
    const validate = async (schema: unknown, value: unknown) =>
      (await (schema as { '~standard': { validate(v: unknown): unknown } } | undefined)?.[
        '~standard'
      ].validate(value)) as { value?: unknown; issues?: unknown[] }

    it('setKey takes a keyed backend and a trimmed key and nothing else', async () => {
      const schema = contract.search.setKey['~orpc'].inputSchema
      expect(await validate(schema, { provider: 'brave', apiKey: ' k1 ' })).toMatchObject({
        value: { provider: 'brave', apiKey: 'k1' },
      })
      expect(await validate(schema, { provider: 'tavily', apiKey: 'tvly-1' })).toMatchObject({
        value: { provider: 'tavily', apiKey: 'tvly-1' },
      })
      expect((await validate(schema, { provider: 'brave', apiKey: '  ' })).issues).toBeDefined()
      expect((await validate(schema, { provider: 'bing', apiKey: 'k' })).issues).toBeDefined()
      // DDGS has no key.
      expect((await validate(schema, { provider: 'ddgs', apiKey: 'k' })).issues).toBeDefined()
      expect((await validate(schema, { apiKey: 'k' })).issues).toBeDefined()
      expect(
        (await validate(schema, { provider: 'brave', apiKey: 'k', label: 'x' })).issues,
      ).toBeDefined()
      expect(
        (await validate(schema, { provider: 'tavily', apiKey: 'x'.repeat(513) })).issues,
      ).toBeDefined()
    })

    it('clearKey takes a keyed backend and nothing else', async () => {
      const schema = contract.search.clearKey['~orpc'].inputSchema
      expect(await validate(schema, { provider: 'tavily' })).toMatchObject({
        value: { provider: 'tavily' },
      })
      expect((await validate(schema, { provider: 'ddgs' })).issues).toBeDefined()
      expect((await validate(schema, {})).issues).toBeDefined()
      expect((await validate(schema, { provider: 'brave', apiKey: 'k' })).issues).toBeDefined()
    })

    it('setKey refuses a key with control characters, spaces or non-ASCII (header injection)', async () => {
      const schema = contract.search.setKey['~orpc'].inputSchema
      for (const apiKey of ['abc\r\ndef', 'ab c', 'abc\u0000', 'clé', 'a\tb']) {
        expect((await validate(schema, { provider: 'brave', apiKey })).issues, apiKey).toBeDefined()
      }
      expect(
        (await validate(schema, { provider: 'brave', apiKey: 'BSA_a-b.c~!' })).issues,
      ).toBeUndefined()
    })

    it('the status never carries a key: unknown fields fail the output schema', async () => {
      const out = contract.search.status['~orpc'].outputSchema
      const brave = {
        provider: 'brave',
        configured: true,
        unreadable: false,
        updatedAt: '2026-01-02T03:04:05.000Z',
      }
      const tavily = { provider: 'tavily', configured: false, unreadable: false, updatedAt: null }
      const ok = { backends: [tavily, brave], fallback: 'ddgs' }
      expect((await validate(out, ok)).issues).toBeUndefined()
      const leaks = [
        { ...ok, apiKey: 'k' },
        { ...ok, backends: [tavily, { ...brave, apiKey: 'k' }] },
        { ...ok, backends: [tavily, { ...brave, keyHint: 'k…' }] },
        { ...ok, fallback: 'bing' },
      ]
      for (const p of [contract.search.status, contract.search.setKey, contract.search.clearKey]) {
        expect((await validate(p['~orpc'].outputSchema, ok)).issues).toBeUndefined()
        for (const leak of leaks) {
          expect((await validate(p['~orpc'].outputSchema, leak)).issues).toBeDefined()
        }
      }
    })
  })

  it('approvals: list pages pending or recent ones; decide takes only an id and a decision', async () => {
    const validate = async (proc: { '~orpc': { inputSchema?: unknown } }, v: unknown) =>
      (await (proc['~orpc'].inputSchema as { '~standard': { validate(v: unknown): unknown } })[
        '~standard'
      ].validate(v)) as { issues?: unknown[] }
    const APPR = 'appr_01HZX3K9V2M4N6P8Q0R2S4T6V8'
    expect((await validate(contract.approvals.list, undefined)).issues).toBeUndefined()
    expect(
      (await validate(contract.approvals.list, { status: 'pending', limit: 200 })).issues,
    ).toBeUndefined()
    expect((await validate(contract.approvals.list, { limit: 201 })).issues).toBeDefined()
    expect((await validate(contract.approvals.list, { limit: 0 })).issues).toBeDefined()
    expect((await validate(contract.approvals.get, { id: APPR })).issues).toBeUndefined()
    expect(
      (await validate(contract.approvals.decide, { id: APPR, decision: 'approve' })).issues,
    ).toBeUndefined()
    // No way to slip new arguments or a policy change into a decision.
    expect(
      (
        await validate(contract.approvals.decide, {
          id: APPR,
          decision: 'approve',
          args: { url: 'https://evil.com/' },
        })
      ).issues,
    ).toBeDefined()
    expect(
      (await validate(contract.approvals.decide, { id: APPR, decision: 'always' })).issues,
    ).toBeDefined()
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
    expectTypeOf<Out['approvals']['get']>().toEqualTypeOf<z.infer<typeof Approval>>()
    expectTypeOf<Out['devices']['pair']['device']>().toEqualTypeOf<z.infer<typeof Device>>()
    expectTypeOf<Out['devices']['pair']['session']['token']>().toEqualTypeOf<string>()
    expectTypeOf<Out['settings']['get']>().toEqualTypeOf<Settings>()
    expectTypeOf<Out['user']['get']>().toEqualTypeOf<UserProfile>()
    expectTypeOf<Out['user']['update']>().toEqualTypeOf<UserProfile>()
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
