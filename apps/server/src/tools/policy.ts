import { hostsFromToolCalls, policyGate, type ToolGate } from '@mawl/core'
import { schema } from '@mawl/db'
import { and, eq, sql } from 'drizzle-orm'
import type { Logger } from '../logger.ts'
import type { ProvidersDb } from '../providers/types.ts'

const { runs, profiles, events } = schema

/**
 * The policy engine wired to the database. Every call reads the run's trigger and the profile's
 * `policy_json` (so an edit applies at once), and `web_fetch` calls read the hosts this run already
 * fetched (allowed or owner-approved) from its own `run.tool_call` events (index
 * `events_run_id_idx`), so a resumed run keeps them. Neither the policy nor the hosts are ever
 * logged.
 */
export function createPolicyGate(db: ProvidersDb, logger?: Logger): ToolGate {
  return policyGate({
    async load({ runId, profileId }) {
      const [row] = await db
        .select({ trigger: runs.trigger, policy: profiles.policy })
        .from(runs)
        .innerJoin(profiles, eq(profiles.id, runs.profileId))
        .where(and(eq(runs.id, runId), eq(runs.profileId, profileId)))
      if (!row) throw new Error('run not found')
      return { policy: row.policy, trigger: row.trigger }
    },
    async seenHosts(runId) {
      const rows = await db
        .select({ payload: events.payload })
        .from(events)
        .where(
          and(
            eq(events.runId, runId),
            eq(events.type, 'run.tool_call'),
            sql`${events.payload}->>'tool' = 'web_fetch'`,
            // Allowed calls, and calls the owner approved (D2.4): either unlocks the host.
            sql`(${events.payload}->>'level' = 'auto' or ${events.payload}->'approved' = 'true'::jsonb)`,
          ),
        )
      return hostsFromToolCalls(rows.map((r) => r.payload))
    },
    onInvalidPolicy(profileId) {
      logger?.warn({ profileId }, 'invalid profile policy; using the default policy')
    },
    onLoadError(err) {
      logger?.error(
        { errName: err instanceof Error ? err.name : typeof err },
        'policy context could not be loaded; deciding with the stricter fallback',
      )
    },
  })
}
