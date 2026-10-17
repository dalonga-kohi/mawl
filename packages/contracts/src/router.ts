import { eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'
import {
  Approval,
  Device,
  Message,
  Profile,
  Run,
  RunBudget,
  Settings,
  SettingsUpdate,
  Thread,
} from './entities'
import { ApprovalStatus, RunStatus } from './enums'
import { Envelope, EventId, Topic } from './events'
import { ApprovalId, DeviceId, ProfileId, RunId, ThreadId } from './ids'

const NotFound = { status: 404, data: z.object({ entity: z.string(), id: z.string() }) }
const Conflict = {
  status: 409,
  data: z.object({ from: RunStatus, to: RunStatus }),
}

const base = oc
const withNotFound = oc.errors({ NOT_FOUND: NotFound })
const runTransition = oc.errors({ NOT_FOUND: NotFound, CONFLICT: Conflict })

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
    decide: oc
      .errors({
        NOT_FOUND: NotFound,
        CONFLICT: { status: 409, data: z.object({ status: ApprovalStatus }) },
      })
      .input(Id(ApprovalId).extend({ decision: z.enum(['approve', 'deny']) }))
      .output(Approval),
  },
  devices: {
    pair: base
      .input(
        Device.pick({ name: true, pubkey: true, platform: true }).extend({
          pairingCode: z.string().min(1),
        }),
      )
      .output(Device),
    list: base.output(z.array(Device)),
    revoke: withNotFound.input(Id(DeviceId)).output(Device),
  },
  settings: {
    get: base.output(Settings),
    update: base.input(SettingsUpdate).output(Settings),
  },
  events: {
    subscribe: base
      .input(z.object({ topics: z.array(Topic).min(1), since: EventId.optional() }))
      .output(eventIterator(Envelope)),
  },
}

export type Contract = typeof contract
