import type { ProfileId, RunId, Topic } from '@faire/contracts'
import { schema } from '@faire/db'
import { inArray, or, type SQL } from 'drizzle-orm'

const { events } = schema

/** The routing fields of an event; both wire envelopes and table rows have them. */
export interface Routed {
  profileId: ProfileId
  runId?: RunId | null | undefined
}

interface Split {
  all: boolean
  profileIds: ProfileId[]
  runIds: RunId[]
}

function split(topics: readonly Topic[]): Split {
  const out: Split = { all: false, profileIds: [], runIds: [] }
  for (const topic of topics) {
    if (topic === 'profile:*') out.all = true
    else if (topic.startsWith('profile:')) out.profileIds.push(topic.slice(8) as ProfileId)
    else out.runIds.push(topic.slice(4) as RunId)
  }
  return out
}

/** True for events a subscription to `topics` should receive. */
export function topicFilter(topics: readonly Topic[]): (e: Routed) => boolean {
  const { all, profileIds, runIds } = split(topics)
  const profiles = new Set<string>(profileIds)
  const runs = new Set<string>(runIds)
  return (e) => all || profiles.has(e.profileId) || (!!e.runId && runs.has(e.runId))
}

/** The same rule as {@link topicFilter}, for a query on `events`. Undefined means no restriction. */
export function topicWhere(topics: readonly Topic[]): SQL | undefined {
  const { all, profileIds, runIds } = split(topics)
  if (all) return undefined
  return or(
    profileIds.length > 0 ? inArray(events.profileId, profileIds) : undefined,
    runIds.length > 0 ? inArray(events.runId, runIds) : undefined,
  )
}
