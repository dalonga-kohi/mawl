import {
  EVENT_PAYLOADS,
  type EventType,
  type Json,
  newId,
  type ProfileId,
  type RunId,
  type StepId,
  type StepKind,
  type Usage,
} from '@faire/contracts'
import { schema } from '@faire/db'
import type { z } from 'zod'
import type { ProvidersDb } from '../providers/types.ts'

const { events, runSteps, jsonValue } = schema

/** A database or an open transaction: node-postgres in production, PGlite in tests. */
export type Queryable = Pick<ProvidersDb, 'insert' | 'select' | 'update'>

export interface EventInput {
  profileId: ProfileId | null
  runId: RunId | null
  type: string
  payload: Json
}

/**
 * The only way the server writes `events`. `payload_json` is NOT NULL jsonb and drizzle turns a
 * JS null into SQL NULL, so every payload goes through `jsonValue()`.
 */
export async function insertEvent(db: Queryable, e: EventInput): Promise<void> {
  await db.insert(events).values({
    profileId: e.profileId,
    runId: e.runId,
    type: e.type,
    payload: jsonValue(e.payload),
  })
}

/** Like insertEvent, but the payload must match the contract schema for its type. */
export async function recordEvent<T extends EventType>(
  db: Queryable,
  e: {
    profileId: ProfileId | null
    runId: RunId | null
    type: T
    payload: z.input<(typeof EVENT_PAYLOADS)[T]>
  },
): Promise<void> {
  const payload = EVENT_PAYLOADS[e.type].parse(e.payload) as Json
  await insertEvent(db, { profileId: e.profileId, runId: e.runId, type: e.type, payload })
}

export interface StepInput {
  runId: RunId
  idx: number
  kind: StepKind
  input: Json
  usage: Usage | null
}

/**
 * The only way the server writes `run_steps` (`input_json` is NOT NULL jsonb, see insertEvent).
 * Returns the new step id, or null when a step with this (run, idx) exists already: the job
 * dedupe rule, so a duplicate execution never writes a second row.
 */
export async function insertRunStep(db: Queryable, s: StepInput): Promise<StepId | null> {
  const id = newId('step')
  const rows = await db
    .insert(runSteps)
    .values({
      id,
      runId: s.runId,
      idx: s.idx,
      kind: s.kind,
      input: jsonValue(s.input),
      usage: s.usage,
    })
    .onConflictDoNothing({ target: [runSteps.runId, runSteps.idx] })
    .returning({ id: runSteps.id })
  return rows[0]?.id ?? null
}
