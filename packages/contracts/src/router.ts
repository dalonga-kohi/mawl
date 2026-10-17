import { eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'
import {
  Approval,
  Device,
  Message,
  PairingCode,
  Profile,
  PublicKey,
  Run,
  RunBudget,
  Settings,
  SettingsUpdate,
  Thread,
  Timestamp,
} from './entities'
import { ApprovalStatus, RunStatus } from './enums'
import { EventId, LenientEnvelope, Topic } from './events'
import { ApprovalId, DeviceId, ProfileId, RunId, ThreadId } from './ids'

const NotFound = { status: 404, data: z.object({ entity: z.string(), id: z.string() }) }
const Conflict = {
  status: 409,
  data: z.object({ from: RunStatus, to: RunStatus }),
}

/** Errors every procedure may raise (auth and input validation are enforced by the server). */
const base = oc.errors({
  UNAUTHORIZED: { status: 401 },
  FORBIDDEN: { status: 403 },
  VALIDATION: {
    status: 422,
    data: z.object({ issues: z.array(z.object({ path: z.string(), message: z.string() })) }),
  },
})
const withNotFound = base.errors({ NOT_FOUND: NotFound })
const runTransition = base.errors({ NOT_FOUND: NotFound, CONFLICT: Conflict })

const Id = <T extends z.ZodType>(schema: T) => z.object({ id: schema })

export const contract = {
  health: {
    get: base.output(z.object({ ok: z.literal(true), version: z.string() })),
  },
  profiles: {
    list: base
      .input(z.object({ includeArchived: z.boolean().optional() }).optional())
      .output(z.array(Profile)),
    get: withNotFound.input(Id(ProfileId)).output(Profile),
    create: base
      .input(
        Profile.pick({ name: true, slug: true, color: true, modelMain: true }).extend({
          personaMd: z.string().optional(),
          modelHelper: z.string().min(1).optional(),
        }),
      )
      .output(Profile),
    update: withNotFound
      .input(
        Id(ProfileId).extend({
          patch: Profile.omit({ id: true, createdAt: true, archivedAt: true }).partial(),
        }),
      )
      .output(Profile),
    archive: withNotFound.input(Id(ProfileId)).output(Profile),
  },
  threads: {
    list: base.input(z.object({ profileId: ProfileId })).output(z.array(Thread)),
    messages: withNotFound
      .input(
        z.object({
          threadId: ThreadId,
          limit: z.number().int().min(1).max(200).optional(),
          before: z.iso.datetime().optional(),
        }),
      )
      .output(z.array(Message)),
  },
  runs: {
    start: withNotFound
      .input(
        z.object({
          profileId: ProfileId,
          threadId: ThreadId.optional(),
          prompt: z.string().min(1),
          budget: RunBudget.optional(),
        }),
      )
      .output(Run),
    get: withNotFound.input(Id(RunId)).output(Run),
    cancel: runTransition.input(Id(RunId)).output(Run),
    pause: runTransition.input(Id(RunId)).output(Run),
    resume: runTransition.input(Id(RunId)).output(Run),
  },
  approvals: {
    list: base
      .input(
        z.object({ profileId: ProfileId.optional(), status: ApprovalStatus.optional() }).optional(),
      )
      .output(z.array(Approval)),
    decide: base
      .errors({
        NOT_FOUND: NotFound,
        CONFLICT: { status: 409, data: z.object({ status: ApprovalStatus }) },
      })
      .input(Id(ApprovalId).extend({ decision: z.enum(['approve', 'deny']) }))
      .output(Approval),
  },
  devices: {
    /**
     * Pair a new device with a one-time code. TODO(P6): replace the code-only proof with the
     * Ed25519 challenge/response auth flow (ARCHITECTURE section 8).
     */
    pair: base
      .input(
        z.strictObject({
          name: Device.shape.name,
          pubkey: PublicKey,
          platform: Device.shape.platform,
          pairingCode: PairingCode,
        }),
      )
      .output(
        z.object({
          device: Device,
          session: z.object({ token: z.string().min(1), expiresAt: Timestamp }),
        }),
      ),
    list: base.output(z.array(Device)),
    revoke: withNotFound.input(Id(DeviceId)).output(Device),
  },
  settings: {
    get: base.output(Settings),
    update: base.input(SettingsUpdate).output(Settings),
  },
  events: {
    /**
     * Streams events over WebSocket. Items are lenient envelopes (any type or version, opaque
     * payload) so old clients survive newer servers: clients MUST run each item through
     * parseEnvelope, skip anything that is not ok, and still advance their since cursor
     * with the item's id.
     */
    subscribe: base
      .input(z.object({ topics: z.array(Topic).min(1), since: EventId.optional() }))
      .output(eventIterator(LenientEnvelope)),
  },
}

export type Contract = typeof contract
