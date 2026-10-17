import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as f from './fixtures'
import * as contracts from './index'
import {
  ChannelBinding,
  ClientMessage,
  canTransition,
  Envelope,
  EVENT_PAYLOADS,
  EVENT_TYPES,
  EventId,
  ID_KINDS,
  ID_PREFIX,
  isId,
  McpServer,
  Message,
  MessagePart,
  PolicyRule,
  ProviderCredential,
  ProviderCredentialInput,
  RUN_TRANSITIONS,
  type RunId,
  RunStatus,
  Settings,
  SettingsUpdate,
  type ThreadId,
  Timestamp,
  Topic,
} from './index'

describe('ids edge cases', () => {
  const body = f.ULID
  it.each(ID_KINDS)(
    '%s: rejects ambiguous Crockford letters I, L, O, U anywhere in the body',
    (kind) => {
      const p = ID_PREFIX[kind]
      for (const bad of ['I', 'L', 'O', 'U']) {
        expect(isId(kind, `${p}_${bad}${body.slice(1)}`)).toBe(false)
        expect(isId(kind, `${p}_${body.slice(0, 25)}${bad}`)).toBe(false)
      }
    },
  )

  it.each(ID_KINDS)('%s: rejects wrong length, lowercase, whitespace, wrong separator', (kind) => {
    const p = ID_PREFIX[kind]
    expect(isId(kind, `${p}_${body.slice(1)}`)).toBe(false) // 25 chars
    expect(isId(kind, `${p}_${body}0`)).toBe(false) // 27 chars
    expect(isId(kind, `${p}_${body.toLowerCase()}`)).toBe(false)
    expect(isId(kind, `${p.toUpperCase()}_${body}`)).toBe(false)
    expect(isId(kind, `${p}-${body}`)).toBe(false)
    expect(isId(kind, `${p}${body}`)).toBe(false)
    expect(isId(kind, ` ${p}_${body}`)).toBe(false)
    expect(isId(kind, `${p}_${body}\n`)).toBe(false)
    expect(isId(kind, `${p}_${body}\n${p}_${body}`)).toBe(false)
  })

  it('no id kind accepts the id of any other kind (full matrix)', () => {
    for (const a of ID_KINDS) {
      for (const b of ID_KINDS) {
        expect(isId(a, `${ID_PREFIX[b]}_${body}`)).toBe(a === b)
      }
    }
  })

  it('prefixes are unique and none is a prefix-of-another ambiguity at the separator', () => {
    const prefixes = Object.values(ID_PREFIX)
    expect(new Set(prefixes).size).toBe(prefixes.length)
  })

  it('does not accept unicode lookalikes or full-width digits', () => {
    expect(isId('run', `run_${'０'.repeat(26)}`)).toBe(false)
    expect(isId('run', `run_${body.slice(0, 25)}Ｚ`)).toBe(false)
  })

  it('type level: an id of one kind is not assignable where another is expected', () => {
    const takesRun = (_: RunId) => {}
    const thread = contracts.ThreadId.parse(`thr_${body}`)
    // @ts-expect-error ThreadId is not RunId
    takesRun(thread)
    // @ts-expect-error a plain string is not a RunId
    takesRun(`run_${body}`)
    const takesThread = (_: ThreadId) => {}
    // @ts-expect-error RunId is not ThreadId
    takesThread(contracts.RunId.parse(`run_${body}`))
    expect(true).toBe(true)
  })
})

describe('RUN_TRANSITIONS vs ARCHITECTURE section 5 diagram', () => {
  // Parsed straight from the mermaid stateDiagram-v2 block in ARCHITECTURE section 5.
  const doc = readFileSync(resolve(import.meta.dirname, '../../../docs/ARCHITECTURE.md'), 'utf8')
  const block = /```mermaid\s+stateDiagram-v2([\s\S]*?)```/.exec(doc)?.[1] ?? ''
  const diagram: Array<[string, string]> = [...block.matchAll(/^\s*(\w+)\s+-->\s+(\w+)/gm)].map(
    (m) => [m[1] as string, m[2] as string],
  )

  it('found the diagram edges in the docs', () => {
    expect(diagram.length).toBeGreaterThanOrEqual(20)
  })
  it('every diagram edge is in the table and every table edge is in the diagram', () => {
    const table = Object.entries(RUN_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}->${to}`),
    )
    expect(table.sort()).toEqual(diagram.map(([a, b]) => `${a}->${b}`).sort())
  })

  it('has no self transitions', () => {
    for (const s of RunStatus.options) expect(canTransition(s, s)).toBe(false)
  })

  it('allows cancel from every non-terminal state, and compacting -> failed', () => {
    for (const from of RunStatus.options) {
      const terminal = ['succeeded', 'failed', 'cancelled'].includes(from)
      expect(canTransition(from, 'cancelled')).toBe(!terminal)
    }
    expect(canTransition('compacting', 'failed')).toBe(true)
    expect(canTransition('paused', 'running')).toBe(false)
    expect(canTransition('running', 'queued')).toBe(false)
    expect(canTransition('queued', 'failed')).toBe(false)
  })
  it('terminal states have no exits to any status', () => {
    for (const t of ['succeeded', 'failed', 'cancelled'] as const) {
      for (const s of RunStatus.options) expect(canTransition(t, s)).toBe(false)
    }
  })
})

describe('secret leakage', () => {
  it('ProviderCredential rejects secret-ish keys, including alongside valid data', () => {
    for (const key of ['secret', 'token', 'apiKey', 'config', 'password', 'secretEnc']) {
      expect(ProviderCredential.safeParse({ ...f.providerCredential, [key]: 'x' }).success).toBe(
        false,
      )
    }
  })

  it('McpServer and ChannelBinding reject secret/token/config/apiKey keys, nested too', () => {
    for (const [schema, fx] of [
      [McpServer, f.mcpServer],
      [ChannelBinding, f.channelBinding],
    ] as const) {
      for (const key of ['secret', 'token', 'config', 'configEnc', 'tokenEnc', 'apiKey', 'env']) {
        expect(schema.safeParse({ ...fx, [key]: 'x' }).success).toBe(false)
        expect(schema.safeParse({ ...fx, [key]: { nested: 'x' } }).success).toBe(false)
      }
    }
    // Nested under a known key: toolPolicy only allows PolicyLevel values.
    expect(
      McpServer.safeParse({ ...f.mcpServer, toolPolicy: { t: { secret: 'x' } } }).success,
    ).toBe(false)
  })

  it('ProviderCredentialInput accepts the secret and rejects unknown keys', () => {
    const input = { provider: 'openai', label: 'k', secret: 'sk-123' }
    expect(ProviderCredentialInput.parse(input).secret).toBe('sk-123')
    expect(ProviderCredentialInput.safeParse({ ...input, token: 'x' }).success).toBe(false)
    expect(ProviderCredentialInput.safeParse({ ...input, secret: '' }).success).toBe(false)
  })

  it('no exported public schema declares a secret-like field (walks all zod shapes)', () => {
    const SECRET_NAME =
      /secret|token|password|passwd|apikey|api_key|credential(?!Id)|authorization|bearer/i
    // Usage/budget counters are not credentials.
    const ALLOWED = new Set([
      'tokenCount',
      'inputTokens',
      'outputTokens',
      'cachedTokens',
      'maxTokens',
    ])
    // The only schema allowed to carry a secret: the write-only input.
    const WRITE_ONLY = new Set<unknown>([ProviderCredentialInput])

    const offenders: string[] = []
    const seen = new Set<unknown>()
    // biome-ignore lint/suspicious/noExplicitAny: introspecting zod internals
    const walk = (s: any, path: string): void => {
      if (!s || typeof s !== 'object' || seen.has(s) || WRITE_ONLY.has(s)) return
      seen.add(s)
      const def = s._zod?.def
      if (!def) return
      switch (def.type) {
        case 'object':
          for (const [k, v] of Object.entries(s.shape)) {
            if (SECRET_NAME.test(k) && !ALLOWED.has(k)) offenders.push(`${path}.${k}`)
            walk(v, `${path}.${k}`)
          }
          break
        case 'optional':
        case 'nullable':
        case 'readonly':
        case 'default':
        case 'nonoptional':
        case 'catch':
          walk(def.innerType, path)
          break
        case 'array':
          walk(def.element, `${path}[]`)
          break
        case 'record':
          walk(def.valueType, `${path}{}`)
          break
        case 'union':
          for (const o of def.options) walk(o, path)
          break
        case 'pipe':
          walk(def.in, path)
          walk(def.out, path)
          break
        case 'lazy':
          break
        default:
          break
      }
    }

    for (const [name, value] of Object.entries(contracts)) {
      if (value instanceof z.ZodType) walk(value, name)
    }
    for (const [type, schema] of Object.entries(EVENT_PAYLOADS))
      walk(schema, `EVENT_PAYLOADS[${type}]`)
    // Router input/output schemas.
    const visitContract = (node: unknown, path: string) => {
      const n = node as { '~orpc'?: { inputSchema?: unknown; outputSchema?: unknown } }
      if (n && typeof n === 'object' && n['~orpc']) {
        walk(n['~orpc'].inputSchema, `${path}:in`)
        walk(n['~orpc'].outputSchema, `${path}:out`)
      } else if (n && typeof n === 'object') {
        for (const [k, v] of Object.entries(n)) visitContract(v, `${path}.${k}`)
      }
    }
    visitContract(contracts.contract, 'contract')

    expect(seen.size).toBeGreaterThan(30) // sanity: the walk actually traversed schemas
    expect(offenders).toEqual([])
  })
})

describe('event payload validation', () => {
  const base = { id: '1', profileId: f.id('prof'), ts: f.TS }
  const invalid: Record<(typeof EVENT_TYPES)[number], unknown> = {
    'run.status': { status: 'exploded' },
    'run.delta': { text: 5 },
    'run.tool_call': { toolCallId: '', tool: 'x', argsRedacted: {}, actionClass: 'read' },
    'run.tool_result': { toolCallId: 'c', preview: 'x' }, // missing isError
    'run.step': { stepId: f.id('run'), idx: 0, kind: 'model' }, // wrong id kind
    'approval.created': { approval: { ...f.approval, status: 'maybe' } },
    'approval.resolved': { approvalId: f.id('appr'), status: 'pending-ish' },
    'takeover.requested': { reason: 'x' }, // missing leaseId
    'takeover.lease': { leaseId: f.id('lease'), state: 'borrowed' },
    'memory.updated': { scope: 'block', ref: '' },
    'routine.fired': { routineId: f.id('rtn') }, // missing runId
    'sandbox.status': { status: 'on fire' },
    'memory.recalled': { refs: [{ kind: 'x', id: 'y' }] },
    notify: { title: 't', body: 'b', level: 'fatal' },
  }

  it('has an invalid-payload case for every event type', () => {
    expect(Object.keys(invalid).sort()).toEqual([...EVENT_TYPES].sort())
  })

  it.each(EVENT_TYPES)('rejects an invalid %s payload', (type) => {
    expect(Envelope.safeParse({ ...base, type, payload: invalid[type] }).success).toBe(false)
  })

  it.each(EVENT_TYPES)('rejects a missing payload for %s', (type) => {
    expect(Envelope.safeParse({ ...base, type }).success).toBe(false)
  })

  it('rejects a malformed runId or profileId on the envelope', () => {
    const ok = { ...base, type: 'notify', payload: { title: 't', body: 'b', level: 'info' } }
    expect(Envelope.safeParse({ ...ok, runId: f.id('prof') }).success).toBe(false)
    expect(Envelope.safeParse({ ...ok, profileId: 'prof_x' }).success).toBe(false)
  })

  it('event id must be a numeric string', () => {
    for (const bad of [1, 1.5, null, '', ' 1', '1 ', '-1', '1.5', '1e3', '0x1', '١٢٣', 'abc']) {
      expect(EventId.safeParse(bad).success).toBe(false)
    }
    for (const good of ['0', '1', '9007199254740993', '99999999999999999999']) {
      expect(EventId.safeParse(good).success).toBe(true)
    }
    const ev = { ...base, id: 7, type: 'notify', payload: { title: 't', body: 'b', level: 'info' } }
    expect(Envelope.safeParse(ev).success).toBe(false)
  })

  it('ts must be an ISO 8601 UTC timestamp', () => {
    const ev = { ...base, type: 'notify', payload: { title: 't', body: 'b', level: 'info' } }
    for (const bad of [
      'yesterday',
      '2026-01-02',
      '2026-01-02 03:04:05',
      '1767323045000',
      1767323045000,
      '',
    ]) {
      expect(Envelope.safeParse({ ...ev, ts: bad }).success).toBe(false)
    }
    expect(Envelope.safeParse({ ...ev, ts: '2026-02-30T00:00:00Z' }).success).toBe(false)
  })

  it('Timestamp documents its offset policy', () => {
    // PRODUCT QUESTION: only `Z` is accepted; `+02:00` offsets are rejected. Pinned as current behaviour.
    expect(Timestamp.safeParse('2026-01-02T03:04:05Z').success).toBe(true)
    expect(Timestamp.safeParse('2026-01-02T03:04:05.123456Z').success).toBe(true)
    expect(Timestamp.safeParse('2026-01-02T03:04:05+02:00').success).toBe(false)
  })

  it('Topic follows the documented grammar: profile:* | run:<id>, no run:*', () => {
    for (const bad of [
      'run:*',
      'profile:*\n',
      ' profile:*',
      'profile:**',
      'PROFILE:*',
      'run:',
      `run:${f.id('run')}\n`,
      `profile:${f.id('prof')}x`,
    ]) {
      expect(Topic.safeParse(bad).success).toBe(false)
    }
    expect(ClientMessage.safeParse({ type: 'subscribe', topics: ['run:*'] }).success).toBe(false)
    expect(
      ClientMessage.safeParse({ type: 'subscribe', topics: ['profile:*'], since: 'x' }).success,
    ).toBe(false)
    expect(ClientMessage.safeParse({ type: 'subscribe', topics: 'profile:*' }).success).toBe(false)
  })
})

describe('settings accent', () => {
  it.each([
    ['#ABCDEF', true],
    ['#abcdef', true],
    ['#abc', false],
    ['#ABCDEFF', false],
    ['ABCDEF', false],
    ['#GGGGGG', false],
    ['blue', false],
    ['', false],
    [' #abcdef', false],
    ['#abcdef\n', false],
  ])('accent %j -> %s', (accent, ok) => {
    expect(Settings.safeParse({ theme: 'dark', accent }).success).toBe(ok)
    expect(SettingsUpdate.safeParse({ accent }).success).toBe(ok)
  })

  it('SettingsUpdate allows partial/empty patches but rejects a bad theme', () => {
    expect(SettingsUpdate.safeParse({}).success).toBe(true)
    expect(SettingsUpdate.safeParse({ theme: 'sepia' }).success).toBe(false)
    expect(Settings.safeParse({ theme: 'dark' }).success).toBe(false)
  })
})

describe('message parts', () => {
  it('rejects an unknown or missing part type and a part carrying the wrong fields', () => {
    expect(MessagePart.safeParse({ type: 'image', url: 'x' }).success).toBe(false)
    expect(MessagePart.safeParse({ text: 'no type' }).success).toBe(false)
    expect(MessagePart.safeParse({ type: 'TEXT', text: 'x' }).success).toBe(false)
    expect(MessagePart.safeParse({ type: 'text' }).success).toBe(false)
    expect(
      MessagePart.safeParse({ type: 'file', artifactId: f.id('run'), mime: 'a/b' }).success,
    ).toBe(false)
  })

  it('tool_result requires a non-empty toolCallId and an isError flag', () => {
    expect(
      MessagePart.safeParse({ type: 'tool_result', toolCallId: 'c1', result: 1, isError: false })
        .success,
    ).toBe(true)
    expect(
      MessagePart.safeParse({ type: 'tool_result', toolCallId: '', result: 1, isError: false })
        .success,
    ).toBe(false)
    expect(MessagePart.safeParse({ type: 'tool_result', result: 1, isError: false }).success).toBe(
      false,
    )
    expect(
      MessagePart.safeParse({ type: 'tool_result', toolCallId: 'c1', result: 1 }).success,
    ).toBe(false)
    expect(MessagePart.safeParse({ type: 'tool_call', toolCallId: 'c1', tool: 'x' }).success).toBe(
      false,
    )
  })

  it('accepts unicode and empty text, and an empty parts array', () => {
    expect(MessagePart.safeParse({ type: 'text', text: '' }).success).toBe(true)
    expect(MessagePart.safeParse({ type: 'text', text: 'zażółć 🦊\u0000' }).success).toBe(true)
    expect(Message.safeParse({ ...f.message, parts: [] }).success).toBe(true)
  })

  it('Message-level: an orphan tool_result (no matching tool_call) is currently accepted', () => {
    // PRODUCT QUESTION: should Message validate tool_result.toolCallId against a
    // tool_call in the same/previous message? Today it does not. Pinned as current behaviour.
    const orphan = {
      ...f.message,
      role: 'tool',
      parts: [{ type: 'tool_result', toolCallId: 'nope', result: null, isError: true }],
    }
    expect(Message.safeParse(orphan).success).toBe(true)
  })
})

describe('policy rule edge cases', () => {
  it('credential and purchase may not be auto or ask, however the rule is scoped', () => {
    for (const actionClass of ['credential', 'purchase'] as const) {
      for (const level of ['auto', 'ask'] as const) {
        expect(
          PolicyRule.safeParse({
            ...f.policyRule,
            profileId: f.id('prof'),
            match: { actionClass },
            level,
          }).success,
        ).toBe(false)
        expect(
          PolicyRule.safeParse({ ...f.policyRule, match: { actionClass, tool: 'x' }, level })
            .success,
        ).toBe(false)
      }
      for (const level of ['handoff', 'block'] as const) {
        expect(
          PolicyRule.safeParse({ ...f.policyRule, match: { actionClass }, level }).success,
        ).toBe(true)
      }
    }
  })

  it('rejects an empty-string criterion', () => {
    expect(PolicyRule.safeParse({ ...f.policyRule, match: { tool: '' } }).success).toBe(false)
  })
})
