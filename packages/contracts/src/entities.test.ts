import { describe, expect, it } from 'vitest'
import {
  Approval,
  Artifact,
  ChannelBinding,
  Device,
  McpServer,
  Message,
  PolicyRule,
  Profile,
  ProviderCredential,
  ProviderCredentialInput,
  Routine,
  Run,
  RunStep,
  Thread,
} from './entities'
import * as f from './fixtures'

describe('entity schemas round-trip valid fixtures', () => {
  it.each([
    ['Profile', Profile, f.profile],
    ['ProviderCredential', ProviderCredential, f.providerCredential],
    ['Thread', Thread, f.thread],
    ['Message', Message, f.message],
    ['Run', Run, f.run],
    ['RunStep', RunStep, f.runStep],
    ['Artifact', Artifact, f.artifact],
    ['Approval', Approval, f.approval],
    ['Routine', Routine, f.routine],
    ['McpServer', McpServer, f.mcpServer],
    ['ChannelBinding', ChannelBinding, f.channelBinding],
    ['Device', Device, f.device],
    ['PolicyRule', PolicyRule, f.policyRule],
  ] as const)('%s', (_name, schema, fixture) => {
    const parsed = schema.parse(fixture)
    expect(parsed).toEqual(fixture)
    expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(fixture)
  })
})

describe('entity schemas reject invalid input', () => {
  it('rejects an id with the wrong prefix', () => {
    expect(Run.safeParse({ ...f.run, id: f.id('prof') }).success).toBe(false)
  })

  it('rejects a non-ISO timestamp', () => {
    expect(Thread.safeParse({ ...f.thread, createdAt: 'yesterday' }).success).toBe(false)
    expect(Thread.safeParse({ ...f.thread, createdAt: '2026-01-02' }).success).toBe(false)
  })

  it('rejects an unknown run status or trigger', () => {
    expect(Run.safeParse({ ...f.run, status: 'sleeping' }).success).toBe(false)
    expect(Run.safeParse({ ...f.run, trigger: 'cron' }).success).toBe(false)
  })

  it('rejects an unknown message part type', () => {
    const bad = { ...f.message, parts: [{ type: 'video', url: 'x' }] }
    expect(Message.safeParse(bad).success).toBe(false)
  })

  it('rejects a routine schedule with an unknown kind', () => {
    const bad = { ...f.routine, schedule: { kind: 'nl', text: 'x' } }
    expect(Routine.safeParse(bad).success).toBe(false)
  })

  it('accepts an rrule schedule', () => {
    const ok = { ...f.routine, schedule: { kind: 'rrule', rule: 'FREQ=DAILY;BYHOUR=8' } }
    expect(Routine.safeParse(ok).success).toBe(true)
  })

  it('rejects a profile color that is not #rrggbb', () => {
    expect(Profile.safeParse({ ...f.profile, color: 'blue' }).success).toBe(false)
  })

  it('rejects a negative step index', () => {
    expect(RunStep.safeParse({ ...f.runStep, idx: -1 }).success).toBe(false)
  })
})

describe('secret-bearing public shapes never carry secrets', () => {
  it('ProviderCredential refuses a secret key', () => {
    const r = ProviderCredential.safeParse({ ...f.providerCredential, secret: 'sk-live' })
    expect(r.success).toBe(false)
  })

  it('ProviderCredentialInput requires a non-empty secret', () => {
    const input = { provider: 'openai', label: 'k', secret: 'sk-1' }
    expect(ProviderCredentialInput.safeParse(input).success).toBe(true)
    expect(ProviderCredentialInput.safeParse({ ...input, secret: '' }).success).toBe(false)
    expect(ProviderCredentialInput.safeParse({ provider: 'openai', label: 'k' }).success).toBe(
      false,
    )
  })

  it('Approval refuses the stored arguments or their hash, only the redacted copy is public', () => {
    expect(Approval.safeParse({ ...f.approval, argsEnc: 'AAEC' }).success).toBe(false)
    expect(Approval.safeParse({ ...f.approval, args: { to: 'a@b.c' } }).success).toBe(false)
    expect(Approval.safeParse({ ...f.approval, argsHash: 'ab'.repeat(32) }).success).toBe(false)
  })

  it('Approval carries its expiry and accepts a cancelled status', () => {
    expect(Approval.safeParse({ ...f.approval, status: 'cancelled' }).success).toBe(true)
    const { expiresAt: _, ...withoutExpiry } = f.approval
    expect(Approval.safeParse(withoutExpiry).success).toBe(false)
  })

  it('McpServer and ChannelBinding refuse token/config keys', () => {
    expect(McpServer.safeParse({ ...f.mcpServer, config: { env: { K: 'v' } } }).success).toBe(false)
    expect(ChannelBinding.safeParse({ ...f.channelBinding, token: 't' }).success).toBe(false)
  })
})

describe('PolicyRule', () => {
  it('requires at least one match criterion', () => {
    expect(PolicyRule.safeParse({ ...f.policyRule, match: {} }).success).toBe(false)
  })

  it('refuses to lower credential or purchase below handoff', () => {
    for (const actionClass of ['credential', 'purchase']) {
      const base = { ...f.policyRule, match: { actionClass } }
      expect(PolicyRule.safeParse({ ...base, level: 'auto' }).success).toBe(false)
      expect(PolicyRule.safeParse({ ...base, level: 'ask' }).success).toBe(false)
      expect(PolicyRule.safeParse({ ...base, level: 'handoff' }).success).toBe(true)
      expect(PolicyRule.safeParse({ ...base, level: 'block' }).success).toBe(true)
    }
  })
})
