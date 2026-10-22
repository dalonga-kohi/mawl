import { newId, type ProfileId, profileTopic, type RunId, runTopic } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { OWNER } from '../auth/principal.ts'
import { scopeTopics, topicFilter } from './topics.ts'

const profileA = newId('profile')
const profileB = newId('profile')
const runA = newId('run')
const runB = newId('run')

const event = (profileId: ProfileId, runId?: RunId) => ({ profileId, ...(runId ? { runId } : {}) })

describe('scopeTopics', () => {
  it('lets the owner subscribe to every topic: every profile and run is theirs', () => {
    const topics = ['profile:*', profileTopic(profileA), runTopic(runA)] as const
    expect(scopeTopics(OWNER, topics)).toEqual(topics)
  })

  it('refuses any other principal, so a new kind cannot inherit the owner scope by accident', () => {
    expect(() => scopeTopics({ kind: 'device' } as never, ['profile:*'])).toThrow(/principal/)
  })
})

describe('topicFilter', () => {
  it('profile:* matches every event', () => {
    const match = topicFilter(['profile:*'])
    expect(match(event(profileA))).toBe(true)
    expect(match(event(profileB, runA))).toBe(true)
  })

  it('a profile topic matches only that profile, with or without a run', () => {
    const match = topicFilter([profileTopic(profileA)])
    expect(match(event(profileA))).toBe(true)
    expect(match(event(profileA, runA))).toBe(true)
    expect(match(event(profileB, runA))).toBe(false)
  })

  it('a run topic matches only that run, even from another profile id', () => {
    const match = topicFilter([runTopic(runA)])
    expect(match(event(profileA, runA))).toBe(true)
    expect(match(event(profileA, runB))).toBe(false)
    expect(match(event(profileA))).toBe(false)
  })

  it('several topics match when any of them matches', () => {
    const match = topicFilter([profileTopic(profileB), runTopic(runA)])
    expect(match(event(profileA, runA))).toBe(true)
    expect(match(event(profileB))).toBe(true)
    expect(match(event(profileA, runB))).toBe(false)
  })
})
