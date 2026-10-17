import { describe, expect, it } from 'vitest'
import { ClientMessage, EVENT_TYPES, Envelope, EventType, Topic } from './events'
import * as f from './fixtures'

const base = { id: '9007199254740993', profileId: f.id('prof'), ts: f.TS }

const payloads: Record<EventType, unknown> = {
  'run.status': { status: 'running', prevStatus: 'queued' },
  'run.delta': { text: 'hel', stepIdx: 0 },
  'run.tool_call': { toolCallId: 'c1', tool: 'shell', args: { cmd: 'ls' }, actionClass: 'shell_exec' },
  'run.tool_result': { toolCallId: 'c1', preview: 'ok', isError: false },
  'run.step': { stepId: f.id('step'), idx: 1, kind: 'tool' },
  'approval.created': { approval: f.approval },
  'approval.resolved': { approvalId: f.id('appr'), status: 'approved' },
  'takeover.requested': { reason: 'captcha' },
  'takeover.lease': { state: 'granted', deviceId: f.id('dev'), expiresAt: f.TS },
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
    expect(Envelope.safeParse({ ...base, type: 'run.status', payload: payloads.notify }).success).toBe(false)
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
    expect(label(Envelope.parse({ ...base, type: 'notify', payload: payloads.notify }))).toBe('other')
  })
})

describe('Topic and ClientMessage', () => {
  it.each(['profile:*', `profile:${f.id('prof')}`, `run:${f.id('run')}`])('accepts topic %s', (t) => {
    expect(Topic.safeParse(t).success).toBe(true)
  })

  it.each(['profile:', 'run:*', 'run:nope', 'thread:x', `profile:${f.id('run')}`, '*'])(
    'rejects topic %s',
    (t) => {
      expect(Topic.safeParse(t).success).toBe(false)
    },
  )

  it('parses subscribe with and without since', () => {
    const a = { type: 'subscribe', topics: ['profile:*'] }
    const b = { type: 'subscribe', topics: [`run:${f.id('run')}`], since: '42' }
    expect(ClientMessage.parse(a)).toEqual(a)
    expect(ClientMessage.parse(b)).toEqual(b)
  })

  it('parses unsubscribe and rejects unknown client messages', () => {
    expect(ClientMessage.safeParse({ type: 'unsubscribe', topics: ['profile:*'] }).success).toBe(true)
    expect(ClientMessage.safeParse({ type: 'ping' }).success).toBe(false)
    expect(ClientMessage.safeParse({ type: 'subscribe', topics: [] }).success).toBe(false)
  })
})
