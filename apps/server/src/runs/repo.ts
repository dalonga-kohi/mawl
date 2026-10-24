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
} from '@mawl/contracts'
import type { ToolCallKey, ToolEmit, ToolResultOutput, ToolResultRecord } from '@mawl/core'
import { schema } from '@mawl/db'
import { and, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import { EVENTS_CHANNEL } from '../events/source.ts'
import type { ProvidersDb } from '../providers/types.ts'

const { events, runSteps, runs, toolResults, jsonValue } = schema

/** A database or an open transaction: node-postgres in production, PGlite in tests. */
export type Queryable = Pick<ProvidersDb, 'insert' | 'select' | 'update' | 'execute'>

export interface EventInput {
  profileId: ProfileId | null
  runId: RunId | null
  type: string
  payload: Json
}

/**
 * The only way the server writes `events`. `payload_json` is NOT NULL jsonb and drizzle turns a
 * JS null into SQL NULL, so every payload goes through `jsonValue()`. In the same transaction it
 * NOTIFYs `mawl_events` with just the id, so the event bus wakes up once the row is committed
 * (a rolled-back transaction notifies nobody). Returns the new event id.
 */
export async function insertEvent(db: Queryable, e: EventInput): Promise<number> {
  const [row] = await db
    .insert(events)
    .values({
      profileId: e.profileId,
      runId: e.runId,
      type: e.type,
      payload: jsonValue(e.payload),
    })
    .returning({ id: events.id })
  if (!row) throw new Error('event insert returned no row')
  await db.execute(sql`select pg_notify(${EVENTS_CHANNEL}, ${JSON.stringify({ id: row.id })})`)
  return row.id
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
): Promise<number> {
  const payload = EVENT_PAYLOADS[e.type].parse(e.payload) as Json
  return insertEvent(db, { profileId: e.profileId, runId: e.runId, type: e.type, payload })
}

/** A `tool_results` row as the run engine's ledger sees it. */
export function toToolRecord(row: typeof toolResults.$inferSelect): ToolResultRecord {
  return {
    toolName: row.toolName,
    // reason: output_json is only ever written by insertToolResult from a ToolResultRecord.
    output: row.output as unknown as ToolResultOutput,
    isError: row.isError,
    preview: row.preview,
    artifactId: row.artifactId,
  }
}

/**
 * The only way the server writes `tool_results`. Inside the caller's transaction: insert the result
 * for (run, step idx, tool call id) unless one exists, and only when it was inserted, its
 * `run.tool_result` event and the tool's emitted events. Returns the stored record, so a second
 * writer gets the first one's result and emits nothing.
 */
export async function insertToolResult(
  tx: Queryable,
  runId: RunId,
  key: ToolCallKey,
  record: ToolResultRecord,
  emit: readonly ToolEmit[],
): Promise<ToolResultRecord> {
  const inserted = await tx
    .insert(toolResults)
    .values({
      runId,
      stepIdx: key.stepIdx,
      toolCallId: key.toolCallId,
      toolName: record.toolName,
      isError: record.isError,
      output: JSON.parse(JSON.stringify(record.output)) as Json,
      preview: record.preview,
      artifactId: record.artifactId,
    })
    .onConflictDoNothing({
      target: [toolResults.runId, toolResults.stepIdx, toolResults.toolCallId],
    })
    .returning({ runId: toolResults.runId })
  if (inserted.length === 0) {
    const [existing] = await tx
      .select()
      .from(toolResults)
      .where(
        and(
          eq(toolResults.runId, runId),
          eq(toolResults.stepIdx, key.stepIdx),
          eq(toolResults.toolCallId, key.toolCallId),
        ),
      )
    if (!existing) throw new Error('tool result vanished after a conflict')
    return toToolRecord(existing)
  }
  const [run] = await tx.select({ profileId: runs.profileId }).from(runs).where(eq(runs.id, runId))
  if (!run) throw new Error('run not found')
  await recordEvent(tx, {
    profileId: run.profileId,
    runId,
    type: 'run.tool_result',
    payload: {
      toolCallId: key.toolCallId,
      preview: record.preview,
      isError: record.isError,
      ...(record.artifactId ? { artifactId: record.artifactId } : {}),
    },
  })
  for (const e of emit) {
    await recordEvent(tx, { profileId: run.profileId, runId, type: e.type, payload: e.payload })
  }
  return record
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
