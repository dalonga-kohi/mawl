import { describe, expect, it } from 'vitest'
import {
  ActionClass,
  canTransition,
  PolicyLevel,
  RUN_TERMINAL_STATUSES,
  RUN_TRANSITIONS,
  RunStatus,
} from './enums'

/** Edges transcribed from the ARCHITECTURE section 5 state diagram. */
const ALLOWED: ReadonlyArray<[RunStatus, RunStatus]> = [
  ['queued', 'running'],
  ['running', 'waiting_approval'],
  ['waiting_approval', 'running'],
  ['running', 'waiting_takeover'],
  ['waiting_takeover', 'running'],
  ['running', 'waiting_user'],
  ['waiting_user', 'running'],
  ['running', 'compacting'],
  ['compacting', 'running'],
  ['running', 'paused'],
  ['paused', 'queued'],
  ['running', 'succeeded'],
  ['running', 'failed'],
  ['running', 'cancelled'],
]

const ILLEGAL: ReadonlyArray<[RunStatus, RunStatus]> = [
  ['queued', 'succeeded'],
  ['queued', 'paused'],
  ['paused', 'running'],
  ['waiting_approval', 'succeeded'],
  ['waiting_user', 'paused'],
  ['compacting', 'failed'],
  ['running', 'running'],
  ['running', 'queued'],
  ['succeeded', 'running'],
  ['failed', 'queued'],
  ['cancelled', 'running'],
]

describe('RUN_TRANSITIONS', () => {
  it.each(ALLOWED)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true)
  })

  it.each(ILLEGAL)('forbids %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false)
  })

  it('contains exactly the documented edges and no others', () => {
    const edges = Object.entries(RUN_TRANSITIONS).flatMap(([from, tos]) =>
      tos.map((to) => `${from}>${to}`),
    )
    expect(edges.sort()).toEqual(ALLOWED.map(([f, t]) => `${f}>${t}`).sort())
  })

  it('has an entry for every status and terminal states have no exits', () => {
    expect(Object.keys(RUN_TRANSITIONS).sort()).toEqual([...RunStatus.options].sort())
    for (const s of ['succeeded', 'failed', 'cancelled'] as const) {
      expect(RUN_TRANSITIONS[s]).toEqual([])
      expect(RUN_TERMINAL_STATUSES).toContain(s)
    }
    expect(RUN_TERMINAL_STATUSES).toHaveLength(3)
  })
})

describe('enums', () => {
  it('lists the documented policy levels and action classes', () => {
    expect(PolicyLevel.options).toEqual(['auto', 'ask', 'handoff', 'block'])
    expect(ActionClass.options).toEqual([
      'read',
      'write_local',
      'send_message',
      'purchase',
      'delete',
      'credential',
      'external_post',
      'shell_exec',
    ])
  })
})
