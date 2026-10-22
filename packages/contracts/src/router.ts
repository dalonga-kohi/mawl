import { eventIterator, oc } from '@orpc/contract'
import { z } from 'zod'
import {
  Approval,
  ChatGptAttemptStatus,
  ChatGptStartResult,
  Device,
  Message,
  PairingCode,
  Profile,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderCredentialRemoved,
  ProviderDescriptor,
  ProviderTestInput,
  ProviderTestResult,
  PublicKey,
  Run,
  RunBudget,
  Settings,
  SettingsUpdate,
  Thread,
  Timestamp,
  UserProfile,
  UserProfileUpdate,
} from './entities'
import { ApprovalStatus, RunStatus } from './enums'
import { EventId, LenientEnvelope, Topic } from './events'
import { ApprovalId, CredentialId, DeviceId, MessageId, ProfileId, RunId, ThreadId } from './ids'
import { parseModelRef } from './model-ref'

/** Most topics one events.subscribe call may name. */
export const MAX_TOPICS = 50

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
/** A model choice must read as `<credentialId>:<modelId>`; whether the credential exists is the server's check. */
const ModelRefString = z
  .string()
  .min(1)
  .refine((v) => parseModelRef(v) !== null, { message: 'Expected <credentialId>:<modelId>' })
/** Input limits. The stored entity stays tolerant; only what clients may write is capped. */
const ProfileName = z.string().trim().min(1).max(80)
const ProfileSlug = Profile.shape.slug.max(40)
const PersonaMd = z.string().max(8000)
const profileWrite = base.errors({
  SLUG_TAKEN: { status: 409, data: z.object({ slug: z.string() }) },
  UNKNOWN_CREDENTIAL: { status: 422, data: z.object({ credentialId: CredentialId }) },
})
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
    create: profileWrite
      .input(
        z.object({
          name: ProfileName,
          modelMain: ModelRefString,
          /** Derived from the name when omitted. */
          slug: ProfileSlug.optional(),
          /** Rotates through the accent presets when omitted. */
          color: Profile.shape.color.optional(),
          personaMd: PersonaMd.optional(),
          modelHelper: ModelRefString.optional(),
        }),
      )
      .output(Profile),
    update: profileWrite
      .errors({ NOT_FOUND: NotFound })
      .input(
        Id(ProfileId).extend({
          patch: Profile.omit({ id: true, createdAt: true, archivedAt: true })
            .extend({
              name: ProfileName,
              slug: ProfileSlug,
              personaMd: PersonaMd,
              modelMain: ModelRefString,
              modelHelper: ModelRefString.nullable(),
            })
            .partial(),
        }),
      )
      .output(Profile),
    archive: withNotFound.input(Id(ProfileId)).output(Profile),
  },
  threads: {
    list: withNotFound.input(z.object({ profileId: ProfileId })).output(z.array(Thread)),
    messages: withNotFound
      .input(
        z.object({
          threadId: ThreadId,
          limit: z.number().int().min(1).max(200).optional(),
          /** Opaque cursor: the id of the oldest message the client already has. */
          before: MessageId.optional(),
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
          prompt: z.string().trim().min(1),
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
  providers: {
    catalog: base.output(z.array(ProviderDescriptor)),
    list: base.output(z.array(ProviderCredential)),
    create: base.input(ProviderCredentialInput).output(ProviderCredential),
    delete: withNotFound.input(Id(CredentialId)).output(ProviderCredentialRemoved),
    /** Tests a stored credential by id, or a not-yet-saved one (nothing is written). */
    test: withNotFound
      .errors({
        // The stored key cannot be decrypted, e.g. the server's master key changed.
        CREDENTIAL_UNREADABLE: { status: 409, data: z.object({ id: CredentialId }) },
        // Too many checks in a short time (a small per-process bucket); wait and try again.
        RATE_LIMITED: { status: 429 },
      })
      .input(ProviderTestInput)
      .output(ProviderTestResult),
    /** Sign in with ChatGPT. The credential appears in `list` once the browser step finishes. */
    chatgpt: {
      /** Starts (or restarts) the single in-flight sign-in attempt. */
      start: base.output(ChatGptStartResult),
      status: withNotFound
        .input(z.strictObject({ attemptId: z.uuid() }))
        .output(ChatGptAttemptStatus),
    },
  },
  settings: {
    get: base.output(Settings),
    update: base.input(SettingsUpdate).output(Settings),
  },
  /** The owner's own profile (one per install). Empty strings until they fill it in. */
  user: {
    get: base.output(UserProfile),
    update: base.input(UserProfileUpdate).output(UserProfile),
  },
  events: {
    /**
     * Streams events over WebSocket. Items are lenient envelopes (any type or version, opaque
     * payload) so old clients survive newer servers: clients MUST run each item through
     * parseEnvelope, skip anything that is not ok, and still advance their since cursor
     * with the item's id.
     */
    subscribe: base
      .errors({
        /** The stream cannot continue (a slow consumer overflowed): invalidate cached data and subscribe again without `since` (live only). */
        RESYNC_REQUIRED: { status: 409 },
        /** One connection already holds the maximum number of concurrent subscriptions. */
        TOO_MANY_SUBSCRIPTIONS: { status: 429 },
      })
      .input(z.object({ topics: z.array(Topic).min(1).max(MAX_TOPICS), since: EventId.optional() }))
      .output(eventIterator(LenientEnvelope)),
  },
}

export type Contract = typeof contract
