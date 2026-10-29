import { describe, expect, it } from 'vitest'
import { PolicyMatch, ProfilePolicy, ProfilePolicyRule } from './entities'
import { NodeKind, PolicyMode, PolicySource } from './enums'
import { EVENT_PAYLOADS } from './events'
import * as f from './fixtures'

describe('PolicyMatch', () => {
  it('accepts a node kind as a criterion (R16)', () => {
    expect(PolicyMatch.safeParse({ nodeKind: 'this_pc' }).success).toBe(true)
    expect(PolicyMatch.safeParse({ nodeKind: 'none' }).success).toBe(false)
  })

  it('rejects unknown keys, so a misspelt criterion never widens a rule', () => {
    expect(PolicyMatch.safeParse({ tool: 'shell', nodekind: 'this_pc' }).success).toBe(false)
  })

  it('caps the criterion lengths', () => {
    expect(PolicyMatch.safeParse({ tool: 'x'.repeat(128) }).success).toBe(true)
    expect(PolicyMatch.safeParse({ tool: 'x'.repeat(129) }).success).toBe(false)
    expect(PolicyMatch.safeParse({ mcpServer: 'x'.repeat(65) }).success).toBe(false)
    expect(PolicyMatch.safeParse({ tool: 't', argPattern: 'x'.repeat(200) }).success).toBe(true)
    expect(PolicyMatch.safeParse({ tool: 't', argPattern: 'x'.repeat(201) }).success).toBe(false)
  })
})

describe('ProfilePolicy', () => {
  it('parses an empty object to the defaults', () => {
    expect(ProfilePolicy.parse({})).toEqual({ mode: 'standard', rules: [], allowedHosts: [] })
  })

  it('parses the fixture', () => {
    expect(ProfilePolicy.parse(f.profilePolicy)).toEqual(f.profilePolicy)
  })

  it('accepts autopilot and rejects an unknown mode', () => {
    expect(ProfilePolicy.safeParse({ mode: 'autopilot' }).success).toBe(true)
    expect(ProfilePolicy.safeParse({ mode: 'yolo' }).success).toBe(false)
  })

  it('is strict at the top level', () => {
    expect(ProfilePolicy.safeParse({ allowAll: true }).success).toBe(false)
  })

  it('keeps the credential and purchase floor on its rules', () => {
    for (const actionClass of ['credential', 'purchase'] as const) {
      expect(ProfilePolicyRule.safeParse({ match: { actionClass }, level: 'auto' }).success).toBe(
        false,
      )
      expect(
        ProfilePolicyRule.safeParse({ match: { actionClass }, level: 'handoff' }).success,
      ).toBe(true)
    }
  })

  it('caps rule count and host count and length', () => {
    const rule = { match: { tool: 'x' }, level: 'ask' }
    expect(ProfilePolicy.safeParse({ rules: Array(200).fill(rule) }).success).toBe(true)
    expect(ProfilePolicy.safeParse({ rules: Array(201).fill(rule) }).success).toBe(false)
    expect(ProfilePolicy.safeParse({ allowedHosts: Array(201).fill('a.com') }).success).toBe(false)
    expect(ProfilePolicy.safeParse({ allowedHosts: ['a'.repeat(254)] }).success).toBe(false)
    expect(ProfilePolicy.safeParse({ allowedHosts: [''] }).success).toBe(false)
  })

  it('rejects a rule with extra keys or no criterion', () => {
    expect(ProfilePolicy.safeParse({ rules: [{ match: {}, level: 'ask' }] }).success).toBe(false)
    expect(
      ProfilePolicy.safeParse({ rules: [{ match: { tool: 'x' }, level: 'ask', id: 'r' }] }).success,
    ).toBe(false)
  })
})

describe('policy enums', () => {
  it('lists the sources, modes and node kinds', () => {
    expect(PolicySource.options).toEqual(['floor', 'user_rule', 'profile', 'global', 'autopilot'])
    expect(PolicyMode.options).toEqual(['standard', 'autopilot'])
    expect(NodeKind.options).toEqual(['this_pc', 'docker_terminal', 'docker_desktop'])
  })
})

describe('run.tool_call audit fields', () => {
  const base = { toolCallId: 'c1', tool: 'web_fetch', argsRedacted: {}, actionClass: 'read' }

  it('keeps old payloads valid', () => {
    expect(EVENT_PAYLOADS['run.tool_call'].safeParse(base).success).toBe(true)
  })

  it('carries the decided level, its source and autopilot', () => {
    const p = { ...base, level: 'ask', source: 'global', mode: 'autopilot' }
    expect(EVENT_PAYLOADS['run.tool_call'].parse(p)).toEqual(p)
    expect(EVENT_PAYLOADS['run.tool_call'].safeParse({ ...base, level: 'maybe' }).success).toBe(
      false,
    )
  })
})
