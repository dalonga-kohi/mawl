import { z } from 'zod'
import {
  ActionClass,
  ApprovalStatus,
  ChannelKind,
  MessageRole,
  PolicyLevel,
  ProviderKind,
  RunStatus,
  RunTrigger,
  StepKind,
  ThemePref,
} from './enums'
import {
  ApprovalId,
  ArtifactId,
  ChannelId,
  CredentialId,
  DeviceId,
  McpServerId,
  MessageId,
  ProfileId,
  RoutineId,
  RuleId,
  RunId,
  StepId,
  ThreadId,
} from './ids'

/** ISO 8601 UTC timestamp, e.g. `2026-01-02T03:04:05.000Z`. */
export const Timestamp = z.iso.datetime()
export type Timestamp = z.infer<typeof Timestamp>

export const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb')

/** Where a conversation or decision came from: a messaging channel or the app itself. */
export const Origin = z.union([ChannelKind, z.literal('app')])
export type Origin = z.infer<typeof Origin>

const Json = z.json()

// --- Policy ---------------------------------------------------------------

const PolicyMatch = z
  .object({
    tool: z.string().min(1).optional(),
    mcpServer: z.string().min(1).optional(),
    actionClass: ActionClass.optional(),
    argPattern: z.string().min(1).optional(),
  })
  .refine(
    (m) => Object.values(m).some((v) => v !== undefined),
    'match needs at least one criterion',
  )

/** `credential` and `purchase` are always handoff (ARCHITECTURE section 5): rules may not lower them. */
export const PolicyRule = z
  .object({
    id: RuleId,
    profileId: ProfileId.nullable(),
    match: PolicyMatch,
    level: PolicyLevel,
  })
  .refine(
    (r) =>
      !(r.match.actionClass === 'credential' || r.match.actionClass === 'purchase') ||
      r.level === 'handoff' ||
      r.level === 'block',
    { message: 'credential and purchase rules cannot be lower than handoff', path: ['level'] },
  )
export type PolicyRule = z.infer<typeof PolicyRule>

// --- Profiles & credentials ----------------------------------------------

export const Profile = z.object({
  id: ProfileId,
  name: z.string().min(1).max(80),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  color: HexColor,
  personaMd: z.string(),
  modelMain: z.string().min(1),
  modelHelper: z.string().min(1).nullable(),
  heartbeatCron: z.string().min(1).nullable(),
  createdAt: Timestamp,
  archivedAt: Timestamp.nullable(),
})
export type Profile = z.infer<typeof Profile>

/** Public shape only. The secret is write-only and never leaves the server. */
export const ProviderCredential = z.strictObject({
  id: CredentialId,
  provider: ProviderKind,
  label: z.string().min(1),
  baseUrl: z.url().nullable(),
  createdAt: Timestamp,
})
export type ProviderCredential = z.infer<typeof ProviderCredential>

export const ProviderCredentialInput = z.strictObject({
  provider: ProviderKind,
  label: z.string().min(1),
  secret: z.string().min(1),
  baseUrl: z.url().optional(),
})
export type ProviderCredentialInput = z.infer<typeof ProviderCredentialInput>

// --- Threads & messages ---------------------------------------------------

export const Thread = z.object({
  id: ThreadId,
  profileId: ProfileId,
  channel: Origin,
  peer: z.string().nullable(),
  title: z.string().nullable(),
  createdAt: Timestamp,
  lastEventAt: Timestamp.nullable(),
})
export type Thread = z.infer<typeof Thread>

export const MessagePart = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    toolCallId: z.string().min(1),
    tool: z.string().min(1),
    args: Json,
  }),
  z.object({
    type: z.literal('tool_result'),
    toolCallId: z.string().min(1),
    result: Json,
    isError: z.boolean(),
  }),
  z.object({
    type: z.literal('file'),
    artifactId: ArtifactId,
    mime: z.string().min(1),
    name: z.string().optional(),
  }),
])
export type MessagePart = z.infer<typeof MessagePart>

export const Message = z.object({
  id: MessageId,
  threadId: ThreadId,
  runId: RunId.nullable(),
  role: MessageRole,
  parts: z.array(MessagePart),
  tokenCount: z.number().int().nonnegative().nullable(),
  createdAt: Timestamp,
})
export type Message = z.infer<typeof Message>

// --- Runs -----------------------------------------------------------------

export const RunBudget = z.object({
  maxTokens: z.number().int().positive().optional(),
  maxSteps: z.number().int().positive().optional(),
  maxWallClockMs: z.number().int().positive().optional(),
  maxCostUsd: z.number().positive().optional(),
})
export type RunBudget = z.infer<typeof RunBudget>

export const Usage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedTokens: z.number().int().nonnegative().optional(),
  costUsd: z.number().nonnegative().optional(),
})
export type Usage = z.infer<typeof Usage>

export const Run = z.object({
  id: RunId,
  profileId: ProfileId,
  threadId: ThreadId.nullable(),
  trigger: RunTrigger,
  status: RunStatus,
  budget: RunBudget,
  usage: Usage,
  segmentNo: z.number().int().nonnegative(),
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  error: z.string().nullable(),
})
export type Run = z.infer<typeof Run>

export const RunStep = z.object({
  id: StepId,
  runId: RunId,
  idx: z.number().int().nonnegative(),
  kind: StepKind,
  input: Json,
  outputRef: z.string().nullable(),
  usage: Usage.nullable(),
  createdAt: Timestamp,
})
export type RunStep = z.infer<typeof RunStep>

export const Artifact = z.object({
  id: ArtifactId,
  profileId: ProfileId,
  runId: RunId.nullable(),
  mime: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  preview: z.string(),
  tokenCount: z.number().int().nonnegative(),
})
export type Artifact = z.infer<typeof Artifact>

// --- Approvals ------------------------------------------------------------

export const Approval = z.object({
  id: ApprovalId,
  runId: RunId,
  tool: z.string().min(1),
  /** Arguments with secrets and personal data already redacted by the server. */
  argsRedacted: z.record(z.string(), Json),
  actionClass: ActionClass,
  status: ApprovalStatus,
  decidedByDevice: DeviceId.nullable(),
  decidedViaChannel: Origin.nullable(),
  createdAt: Timestamp,
  decidedAt: Timestamp.nullable(),
})
export type Approval = z.infer<typeof Approval>

// --- Routines -------------------------------------------------------------

export const Schedule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cron'), expr: z.string().min(1), timezone: z.string().min(1) }),
  z.object({ kind: z.literal('rrule'), rule: z.string().min(1) }),
])
export type Schedule = z.infer<typeof Schedule>

export const Routine = z.object({
  id: RoutineId,
  profileId: ProfileId,
  name: z.string().min(1),
  schedule: Schedule,
  /** The natural-language phrase the schedule was parsed from, if any. */
  nlSource: z.string().nullable(),
  prompt: z.string().min(1),
  deliveryChannel: Origin.nullable(),
  enabled: z.boolean(),
  lastRunId: RunId.nullable(),
})
export type Routine = z.infer<typeof Routine>

// --- MCP, channels, devices ----------------------------------------------

/** Public shape: transport config (which may hold secrets) stays server-side. */
export const McpServer = z.strictObject({
  id: McpServerId,
  profileId: ProfileId.nullable(),
  name: z.string().min(1),
  transport: z.enum(['stdio', 'http', 'sse']),
  enabled: z.boolean(),
  toolPolicy: z.record(z.string(), PolicyLevel),
})
export type McpServer = z.infer<typeof McpServer>

/** Public shape: the bot token stays server-side. */
export const ChannelBinding = z.strictObject({
  id: ChannelId,
  profileId: ProfileId,
  kind: ChannelKind,
  allowlist: z.array(z.string()),
  status: z.enum(['connected', 'disconnected', 'error']),
})
export type ChannelBinding = z.infer<typeof ChannelBinding>

/**
 * Ed25519 public key: unpadded base64url of exactly 32 bytes (43 chars; the last char's low
 * two bits must be zero so the encoding is canonical).
 */
export const PublicKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/, 'expected base64url of 32 bytes')
export type PublicKey = z.infer<typeof PublicKey>

/**
 * One-time pairing code shown by the server: 8 Crockford base32 chars (no I, L, O, U).
 * Input is case-insensitive and normalised to uppercase.
 */
export const PairingCode = z
  .string()
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{8}$/, 'expected 8 Crockford base32 characters'))
export type PairingCode = z.infer<typeof PairingCode>

export const Device = z.object({
  id: DeviceId,
  name: z.string().min(1),
  pubkey: PublicKey,
  platform: z.enum(['desktop', 'ios', 'android', 'web']),
  lastSeenAt: Timestamp.nullable(),
  revokedAt: Timestamp.nullable(),
})
export type Device = z.infer<typeof Device>

// --- Settings ---------------------------------------------------------------

export const Settings = z.object({
  theme: ThemePref,
  /** Accent colour as `#rrggbb`; the UI derives its palette from it. */
  accent: HexColor,
})
export type Settings = z.infer<typeof Settings>

export const SettingsUpdate = Settings.partial()
export type SettingsUpdate = z.infer<typeof SettingsUpdate>
