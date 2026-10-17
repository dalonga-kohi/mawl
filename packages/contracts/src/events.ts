import { z } from 'zod'
import { Approval, Origin, Timestamp, Usage } from './entities'
import { ActionClass, ApprovalStatus, RunStatus, StepKind } from './enums'
import {
  ApprovalId,
  ArtifactId,
  DeviceId,
  LeaseId,
  MessageId,
  ProfileId,
  RoutineId,
  RunId,
  StepId,
} from './ids'

const Json = z.json()

/** Event payloads, keyed by event type (ARCHITECTURE section 10). */
export const EVENT_PAYLOADS = {
  'run.status': z.object({
    status: RunStatus,
    prevStatus: RunStatus.optional(),
    error: z.string().optional(),
  }),
  'run.delta': z.object({ text: z.string(), stepIdx: z.number().int().nonnegative().optional() }),
  'run.tool_call': z.object({
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    /** Arguments with secrets and personal data already redacted (same naming as Approval). */
    argsRedacted: Json,
    actionClass: ActionClass,
  }),
  'run.tool_result': z.object({
    toolCallId: z.string().min(1),
    /** Truncated preview; large outputs live in an artifact. */
    preview: z.string(),
    artifactId: ArtifactId.optional(),
    isError: z.boolean(),
  }),
  'run.step': z.object({
    stepId: StepId,
    idx: z.number().int().nonnegative(),
    kind: StepKind,
    usage: Usage.optional(),
  }),
  'approval.created': z.object({ approval: Approval }),
  'approval.resolved': z.object({
    approvalId: ApprovalId,
    status: ApprovalStatus,
    via: Origin.optional(),
  }),
  'takeover.requested': z.object({ leaseId: LeaseId, reason: z.string() }),
  'takeover.lease': z.object({
    leaseId: LeaseId,
    state: z.enum(['granted', 'released', 'expired']),
    deviceId: DeviceId.optional(),
    expiresAt: Timestamp.optional(),
  }),
  /** Memories injected into context for a step (powers the used-memories affordance). */
  'memory.recalled': z.object({
    messageId: MessageId.optional(),
    refs: z.array(
      z.object({
        kind: z.enum(['fact', 'block', 'episode', 'skill']),
        id: z.string().min(1),
        score: z.number().optional(),
      }),
    ),
  }),
  'memory.updated': z.object({
    scope: z.enum(['block', 'archival', 'skill']),
    ref: z.string().min(1),
    summary: z.string().optional(),
  }),
  'routine.fired': z.object({ routineId: RoutineId, runId: RunId }),
  'sandbox.status': z.object({
    status: z.enum(['starting', 'running', 'suspended', 'error']),
    detail: z.string().optional(),
  }),
  notify: z.object({
    title: z.string(),
    body: z.string(),
    level: z.enum(['info', 'warn', 'error']),
  }),
} as const

export type EventType = keyof typeof EVENT_PAYLOADS
export const EVENT_TYPES = Object.keys(EVENT_PAYLOADS) as EventType[]
export const EventType = z.enum(EVENT_TYPES as [EventType, ...EventType[]])

/** bigserial event id carried as a decimal string (exceeds JS safe integers). */
export const EventId = z.string().regex(/^\d+$/, 'expected decimal event id')
export type EventId = z.infer<typeof EventId>

function envelopeFor<T extends EventType>(type: T) {
  return z.object({
    id: EventId,
    type: z.literal(type),
    profileId: ProfileId,
    runId: RunId.optional(),
    ts: Timestamp,
    payload: EVENT_PAYLOADS[type],
  })
}

export const Envelope = z.discriminatedUnion('type', [
  envelopeFor('run.status'),
  envelopeFor('run.delta'),
  envelopeFor('run.tool_call'),
  envelopeFor('run.tool_result'),
  envelopeFor('run.step'),
  envelopeFor('approval.created'),
  envelopeFor('approval.resolved'),
  envelopeFor('takeover.requested'),
  envelopeFor('takeover.lease'),
  envelopeFor('memory.recalled'),
  envelopeFor('memory.updated'),
  envelopeFor('routine.fired'),
  envelopeFor('sandbox.status'),
  envelopeFor('notify'),
])
export type Envelope = z.infer<typeof Envelope>

export type Topic = 'profile:*' | `profile:${ProfileId}` | `run:${RunId}`
const TOPIC_RE = /^(?:profile:(?:\*|prof_[0-7][0-9A-HJKMNP-TV-Z]{25})|run:run_[0-7][0-9A-HJKMNP-TV-Z]{25})$/
export const Topic = z.custom<Topic>((v) => typeof v === 'string' && TOPIC_RE.test(v), 'invalid topic')

/** Typed topic builders: the branded id type keeps arbitrary strings out of `Topic`. */
export const profileTopic = (id: ProfileId): Topic => `profile:${id}`
export const runTopic = (id: RunId): Topic => `run:${id}`

const Topics = z.array(Topic).min(1)

export const ClientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribe'), topics: Topics, since: EventId.optional() }),
  z.object({ type: z.literal('unsubscribe'), topics: Topics }),
])
export type ClientMessage = z.infer<typeof ClientMessage>
