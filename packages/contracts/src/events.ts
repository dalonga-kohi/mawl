import { z } from 'zod'
import { Approval, Origin, Timestamp, Usage } from './entities'
import {
  ActionClass,
  ApprovalStatus,
  PolicyLevel,
  PolicyMode,
  PolicySource,
  RunErrorCode,
  RunStatus,
  StepKind,
} from './enums'
import {
  ApprovalId,
  ArtifactId,
  DeviceId,
  ID_PREFIX,
  LeaseId,
  MessageId,
  ProfileId,
  RoutineId,
  RunId,
  StepId,
  ULID_BODY,
} from './ids'

const Json = z.json()

/** Event payloads, keyed by event type (ARCHITECTURE section 10). */
export const EVENT_PAYLOADS = {
  'run.status': z.object({
    status: RunStatus,
    prevStatus: RunStatus.optional(),
    error: RunErrorCode.optional(),
  }),
  'run.delta': z.object({ text: z.string(), stepIdx: z.number().int().nonnegative().optional() }),
  'run.tool_call': z.object({
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    /** Arguments with secrets and personal data already redacted (same naming as Approval). */
    argsRedacted: Json,
    actionClass: ActionClass,
    /** The policy level decided for this call (D2.3). Absent on events written before it. */
    level: PolicyLevel.optional(),
    /** Which policy tier decided the level. */
    source: PolicySource.optional(),
    /** Present (`autopilot`) when the profile ran in Autopilot mode. */
    mode: PolicyMode.optional(),
    /** Set when the call runs because the owner approved it (D2.4); `level` keeps the policy's answer. */
    approved: z.literal(true).optional(),
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

/** Wire version of the envelope. Bumped only for breaking envelope or payload changes. */
export const ENVELOPE_VERSION = 1

function envelopeFor<T extends EventType>(type: T) {
  return z.object({
    v: z.literal(ENVELOPE_VERSION),
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

/**
 * Forward-compatible envelope used as the `events.subscribe` stream item: any type, any
 * version, opaque payload. It lets an old client keep reading a stream that a newer server
 * extends. Clients MUST run each item through {@link parseEnvelope} and advance their
 * `since` cursor with `id` even when the event is skipped.
 */
export const LenientEnvelope = z.object({
  v: z.number().int().positive(),
  id: EventId,
  type: z.string().min(1),
  profileId: ProfileId,
  runId: RunId.optional(),
  ts: Timestamp,
  payload: z.unknown(),
})
export type LenientEnvelope = z.infer<typeof LenientEnvelope>

export type ParsedEnvelope =
  | { ok: true; event: Envelope }
  | {
      ok: false
      reason: 'unknown_type' | 'unsupported_version' | 'invalid'
      id?: EventId
      type?: string
    }

/**
 * Parse one raw stream item without throwing. Known types of version 1 parse strictly;
 * unknown types and newer versions are reported (not thrown) so callers can skip them and
 * still advance their cursor using `id`.
 */
export function parseEnvelope(raw: unknown): ParsedEnvelope {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return { ok: false, reason: 'invalid' }
  const r = raw as Record<string, unknown>
  const idRes = EventId.safeParse(r.id)
  const meta = {
    ...(idRes.success ? { id: idRes.data } : {}),
    ...(typeof r.type === 'string' ? { type: r.type } : {}),
  }
  if (typeof r.v !== 'number' || !Number.isInteger(r.v) || r.v < 1)
    return { ok: false, reason: 'invalid', ...meta }
  if (r.v > ENVELOPE_VERSION) return { ok: false, reason: 'unsupported_version', ...meta }
  if (typeof r.type !== 'string' || !(EVENT_TYPES as string[]).includes(r.type)) {
    return { ok: false, reason: typeof r.type === 'string' ? 'unknown_type' : 'invalid', ...meta }
  }
  const parsed = Envelope.safeParse(raw)
  return parsed.success
    ? { ok: true, event: parsed.data }
    : { ok: false, reason: 'invalid', ...meta }
}

export type Topic = 'profile:*' | `profile:${ProfileId}` | `run:${RunId}`
const TOPIC_RE = new RegExp(
  `^(?:profile:(?:\\*|${ID_PREFIX.profile}_${ULID_BODY})|run:${ID_PREFIX.run}_${ULID_BODY})$`,
)
export const Topic = z.custom<Topic>(
  (v) => typeof v === 'string' && TOPIC_RE.test(v),
  'invalid topic',
)

/** Typed topic builders: the branded id type keeps arbitrary strings out of `Topic`. */
export const profileTopic = (id: ProfileId): Topic => `profile:${id}`
export const runTopic = (id: RunId): Topic => `run:${id}`
