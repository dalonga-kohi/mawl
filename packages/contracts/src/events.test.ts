import { describe, expect, it } from 'vitest'
import { Envelope, EVENT_TYPES, type EventType, profileTopic, runTopic, Topic } from './events'
import * as f from './fixtures'
import { ProfileId, RunId } from './ids'

const base = { v: 1, id: '9007199254740993', profileId: f.id('prof'), ts: f.TS }

const payloads: Record<EventType, unknown> = {
  'run.status': { status: 'running', prevStatus: 'queued' },
  'run.delta': { text: 'hel', stepIdx: 0 },
  'run.tool_call': {
    toolCallId: 'c1',
    tool: 'shell',
    argsRedacted: { cmd: 'ls' },
    actionClass: 'shell_exec',
  },
  'run.tool_result': { toolCallId: 'c1', preview: 'ok', artifactId: f.id('art'), isError: false },
  'run.step': { stepId: f.id('step'), idx: 1, kind: 'tool' },
  'approval.created': { approval: f.approval },
  'approval.resolved': { approvalId: f.id('appr'), status: 'approved' },
  'takeover.requested': { leaseId: f.id('lease'), reason: 'captcha' },
  'takeover.lease': {
    leaseId: f.id('lease'),
    state: 'granted',
    deviceId: f.id('dev'),
    expiresAt: f.TS,
  },
  'memory.recalled': {
    messageId: f.id('msg'),
    refs: [
      { kind: 'fact', id: 'f1', score: 0.9 },
      { kind: 'block', id: 'persona' },
    ],
  },
  'memory.updated': { scope: 'block', ref: 'persona' },
  'routine.fired': { routineId: f.id('rtn'), runId: f.id('run') },
  'sandbox.status': { status: 'running' },
  notify: { title: 'Done', body: 'Finished', level: 'info' },
}

describe('Envelope', () => {
  it('lists every documented event type', () => {
    expect([...EVENT_TYPES].sort()).toEqual(Object.keys(payloads).sort())
  })

  it.each(EVENT_TYPES)('parses a %s event', (type) => {
    const ev = { ...base, type, runId: f.id('run'), payload: payloads[type] }
    expect(Envelope.parse(ev)).toEqual(ev)
  })

  it('treats runId as optional', () => {
    const ev = { ...base, type: 'notify', payload: payloads.notify }
    expect(Envelope.safeParse(ev).success).toBe(true)
  })

  it('rejects an unknown event type', () => {
    expect(Envelope.safeParse({ ...base, type: 'run.exploded', payload: {} }).success).toBe(false)
  })

  it('rejects a payload that belongs to another event type', () => {
    expect(
      Envelope.safeParse({ ...base, type: 'run.status', payload: payloads.notify }).success,
    ).toBe(false)
  })

  it('rejects a non-numeric event id', () => {
    const ev = { ...base, id: 'abc', type: 'notify', payload: payloads.notify }
    expect(Envelope.safeParse(ev).success).toBe(false)
  })

  it('is exhaustively switchable on type', () => {
    // Compile-time: adding a type to the union without a case here breaks `tsc`.
    const label = (e: Envelope): string => {
      switch (e.type) {
        case 'run.status':
        case 'run.delta':
        case 'run.tool_call':
        case 'run.tool_result':
        case 'run.step':
          return 'run'
        case 'approval.created':
        case 'approval.resolved':
          return 'approval'
        case 'takeover.requested':
        case 'takeover.lease':
          return 'takeover'
        case 'memory.updated':
        case 'memory.recalled':
        case 'routine.fired':
        case 'sandbox.status':
        case 'notify':
          return 'other'
        default: {
          const unreachable: never = e
          return unreachable
        }
      }
    }
    expect(label(Envelope.parse({ ...base, type: 'notify', payload: payloads.notify }))).toBe(
      'other',
    )
  })
})

describe('Topic', () => {
  it.each(['profile:*', `profile:${f.id('prof')}`, `run:${f.id('run')}`])(
    'accepts topic %s',
    (t) => {
      expect(Topic.safeParse(t).success).toBe(true)
    },
  )

  it.each(['profile:', 'run:*', 'run:nope', 'thread:x', `profile:${f.id('run')}`, '*'])(
    'rejects topic %s',
    (t) => {
      expect(Topic.safeParse(t).success).toBe(false)
    },
  )
})

describe('payload specifics', () => {
  const ev = (type: string, payload: unknown) => ({ ...base, type, payload })

  it('rejects a non-artifact id on run.tool_result.artifactId', () => {
    const p = { toolCallId: 'c', preview: '', artifactId: f.id('run'), isError: false }
    expect(Envelope.safeParse(ev('run.tool_result', p)).success).toBe(false)
  })

  it('requires leaseId on takeover events', () => {
    expect(Envelope.safeParse(ev('takeover.requested', { reason: 'x' })).success).toBe(false)
    expect(Envelope.safeParse(ev('takeover.lease', { state: 'granted' })).success).toBe(false)
  })

  it('validates memory.recalled refs', () => {
    const bad = { refs: [{ kind: 'dream', id: 'x' }] }
    expect(Envelope.safeParse(ev('memory.recalled', bad)).success).toBe(false)
    expect(Envelope.safeParse(ev('memory.recalled', { refs: [] })).success).toBe(true)
  })

  it('builds topics with typed helpers', () => {
    expect(profileTopic(ProfileId.parse(f.id('prof')))).toBe(`profile:${f.id('prof')}`)
    expect(runTopic(RunId.parse(f.id('run')))).toBe(`run:${f.id('run')}`)
    expect(Topic.safeParse(runTopic(RunId.parse(f.id('run')))).success).toBe(true)
  })
})
