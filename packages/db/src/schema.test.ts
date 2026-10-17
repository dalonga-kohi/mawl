import {
  ChannelKind,
  MessageRole,
  ProviderCredential,
  ProviderKind,
  RunStatus,
  RunTrigger,
  StepKind,
} from '@faire/contracts'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import * as schema from './schema.ts'

const columnsOf = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t)
    .columns.map((c) => c.name)
    .sort()

describe('pg enums mirror contracts', () => {
  it.each([
    ['runStatus', schema.runStatus, RunStatus],
    ['runTrigger', schema.runTrigger, RunTrigger],
    ['stepKind', schema.stepKind, StepKind],
    ['messageRole', schema.messageRole, MessageRole],
    ['providerKind', schema.providerKind, ProviderKind],
  ] as const)('%s', (_name, pgEnum, zodEnum) => {
    expect([...pgEnum.enumValues]).toEqual([...zodEnum.options])
  })

  it('thread origin = app + channel kinds', () => {
    expect([...schema.ORIGINS]).toEqual(['app', ...ChannelKind.options])
  })
})

describe('table columns (ARCHITECTURE section 9)', () => {
  it.each([
    [
      'profiles',
      schema.profiles,
      'archived_at color created_at heartbeat_cron id model_helper model_main name persona_md policy_json slug',
    ],
    [
      'provider_credentials',
      schema.providerCredentials,
      'base_url created_at id label provider secret_enc',
    ],
    ['threads', schema.threads, 'channel created_at id last_event_at peer profile_id title'],
    ['messages', schema.messages, 'created_at id parts_json role run_id thread_id token_count'],
    [
      'runs',
      schema.runs,
      'budget_json created_at ended_at error id profile_id segment_no started_at status thread_id trigger usage_json',
    ],
    [
      'run_steps',
      schema.runSteps,
      'created_at id idx input_json kind output_ref run_id usage_json',
    ],
    [
      'artifacts',
      schema.artifacts,
      'content created_at id mime path preview profile_id run_id size_bytes token_count',
    ],
    ['events', schema.events, 'created_at id payload_json profile_id run_id type'],
  ] as const)('%s', (name, table, cols) => {
    expect(getTableConfig(table).name).toBe(name)
    expect(columnsOf(table)).toEqual(cols.split(' ').sort())
  })

  it('has no plaintext secret column', () => {
    expect(columnsOf(schema.providerCredentials)).not.toContain('secret')
  })
})

describe('providerCredentialPublicColumns', () => {
  it('projects exactly the public ProviderCredential keys, never secretEnc', () => {
    expect(Object.keys(schema.providerCredentialPublicColumns).sort()).toEqual(
      Object.keys(ProviderCredential.shape).sort(),
    )
    expect(Object.keys(schema.providerCredentialPublicColumns)).not.toContain('secretEnc')
  })
})
