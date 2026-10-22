import { z } from 'zod'
import {
  ActionClass,
  ApprovalStatus,
  ChannelKind,
  MessageRole,
  PolicyLevel,
  ProviderKind,
  RunErrorCode,
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

/** Any JSON value, including 
ull. */
export const Json = z.json()
export type Json = z.infer<typeof Json>

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
  /** The owner's own ChatGPT account email; null for API-key providers. */
  accountEmail: z.string().min(1).nullable(),
  /** ChatGPT sign-in only: false when the grant lacks plan usage, so no inference is possible. */
  planUsage: z.boolean(),
  /** ChatGPT sign-in only: the stored tokens were revoked or expired, so the owner must sign in again. */
  reauthRequired: z.boolean(),
  createdAt: Timestamp,
})
export type ProviderCredential = z.infer<typeof ProviderCredential>

/**
 * What providers.delete returns: the removed credential and whether the provider confirmed the
 * revocation. False means the app should tell the owner to revoke access in ChatGPT settings.
 * API-key providers have nothing to revoke and always answer true.
 */
export const ProviderCredentialRemoved = ProviderCredential.extend({ revoked: z.boolean() })
export type ProviderCredentialRemoved = z.infer<typeof ProviderCredentialRemoved>

/**
 * http(s) only. No embedded user:password (it would be stored and logged in clear) and no
 * query or fragment (a base url gets paths appended, and a query could carry a key).
 * Trailing slashes are stripped, matching `resolveBaseUrl` in core.
 */
const HttpUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((u) => {
    const { username, password } = new URL(u)
    return username === '' && password === ''
  }, 'base url must not contain credentials')
  .refine(
    (u) => !u.includes('?') && !u.includes('#'),
    'base url must not contain a query or fragment',
  )
  .transform((u) => u.replace(/\/+$/, ''))

/** Providers that cannot work without an API key. */
const KEY_REQUIRED: ReadonlySet<string> = new Set(['anthropic', 'openai', 'openrouter'])

const credentialInputShape = {
  provider: ProviderKind,
  label: z.string().min(1).max(80),
  secret: z.string().min(1).max(4096).optional(),
  baseUrl: HttpUrl.optional(),
}

function refineCredentialInput(
  v: {
    provider: z.infer<typeof ProviderKind>
    secret?: string | undefined
    baseUrl?: string | undefined
  },
  ctx: z.RefinementCtx,
): void {
  if (v.provider === 'openai_chatgpt') {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'openai_chatgpt credentials come only from Sign in with ChatGPT',
    })
  }
  if (v.provider === 'anthropic_claude_code') {
    // Mawl never holds a Claude credential: the owner signs in with `claude auth login`.
    for (const field of ['secret', 'baseUrl'] as const) {
      if (v[field] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `anthropic_claude_code takes no ${field}: sign in with \`claude auth login\` on the server`,
        })
      }
    }
  }
  if (KEY_REQUIRED.has(v.provider) && v.secret === undefined) {
    ctx.addIssue({ code: 'custom', path: ['secret'], message: 'secret is required' })
  }
  if (v.provider === 'openai_compatible' && v.baseUrl === undefined) {
    ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'baseUrl is required' })
  }
}

/** Write-only: the secret is encrypted on arrival and never returned. */
export const ProviderCredentialInput = z
  .strictObject(credentialInputShape)
  .superRefine(refineCredentialInput)
export type ProviderCredentialInput = z.infer<typeof ProviderCredentialInput>

/**
 * Owner opt-in for a key test against loopback or a private network (Ollama on the LAN). Without
 * it the server tests only public addresses and the provider's own default url; link-local and
 * metadata addresses are refused either way.
 */
const AllowPrivateNetwork = z.boolean().optional()

/** An unsaved credential to test. Write-only like ProviderCredentialInput: never returned. */
export const ProviderTestInlineInput = z
  .strictObject({ ...credentialInputShape, allowPrivateNetwork: AllowPrivateNetwork })
  .superRefine(refineCredentialInput)

/** `providers.test` input: a stored credential by id, or an unsaved one; nothing is written. */
export const ProviderTestInput = z.union([
  z.strictObject({ id: CredentialId, allowPrivateNetwork: AllowPrivateNetwork }),
  ProviderTestInlineInput,
])
export type ProviderTestInput = z.infer<typeof ProviderTestInput>

/** Why a key test failed. Closed set: provider error text can echo keys, so none is ever returned. */
export const ProviderTestFailure = z.enum([
  'invalid_key',
  'unreachable',
  'rate_limited',
  'unexpected_response',
  // Claude subscription only: the Claude Code binary has no login, or uses a login Mawl refuses.
  'not_signed_in',
  'wrong_auth_method',
  // The address is never reachable (link-local, metadata), or private without the opt-in.
  'blocked_address',
])
export type ProviderTestFailure = z.infer<typeof ProviderTestFailure>

export const ProviderTestResult = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), latencyMs: z.number().int().nonnegative() }),
  z.strictObject({ ok: z.literal(false), reason: ProviderTestFailure }),
])
export type ProviderTestResult = z.infer<typeof ProviderTestResult>

export const ProviderCapabilities = z.strictObject({
  supportsTools: z.boolean(),
  supportsCaching: z.boolean(),
  supportsContextEditing: z.boolean(),
  supportsCompaction: z.boolean(),
})
export type ProviderCapabilities = z.infer<typeof ProviderCapabilities>

/** What the app needs to render an "add provider" form. Static; same for every owner. */
export const ProviderDescriptor = z.strictObject({
  kind: ProviderKind,
  label: z.string().min(1),
  keyRequired: z.boolean(),
  baseUrlRequired: z.boolean(),
  defaultBaseUrl: z.string().min(1).nullable(),
  capabilities: ProviderCapabilities,
})
export type ProviderDescriptor = z.infer<typeof ProviderDescriptor>

// --- Sign in with ChatGPT ----------------------------------------------------

/** Why a sign-in attempt ended without a credential. Closed set: provider text is never returned. */
export const ChatGptSignInFailure = z.enum([
  'access_denied',
  'oauth_error',
  'state_mismatch',
  'registration_incomplete',
  'client_mismatch',
  'exchange_failed',
  'invalid_id_token',
  'expired',
  'cancelled',
  'listener_failed',
])
export type ChatGptSignInFailure = z.infer<typeof ChatGptSignInFailure>

export const ChatGptStartResult = z.strictObject({
  attemptId: z.uuid(),
  /** Open this in a browser on the server host; the loopback callback finishes the sign-in. */
  authorizeUrl: z.url(),
})
export type ChatGptStartResult = z.infer<typeof ChatGptStartResult>

export const ChatGptAttemptStatus = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('pending') }),
  z.strictObject({ status: z.literal('succeeded'), credentialId: CredentialId }),
  z.strictObject({ status: z.literal('failed'), reason: ChatGptSignInFailure }),
])
export type ChatGptAttemptStatus = z.infer<typeof ChatGptAttemptStatus>

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
  /** Milliseconds the run was actually working (paused time and downtime excluded). The wall-clock budget counts this. */
  activeMs: z.number().int().nonnegative(),
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  error: RunErrorCode.nullable(),
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
  .regex(/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{8}$/, 'expected 8 Crockford base32 characters')
  .transform((s) => s.toUpperCase())
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

// --- The owner's profile -----------------------------------------------------

export const USER_NAME_MAX = 80
export const USER_CONTEXT_MAX = 2000

/**
 * The owner (the person teammates work for): their name and what every teammate should always
 * know about them. It seeds the `user` core memory block (MEMORY.md §2). Both fields are free text
 * the owner typed: data, never instructions, wherever they are shown or put into a prompt.
 * Strict, so nothing else (and never a secret) can ride along.
 */
export const UserProfile = z.strictObject({
  name: z.string(),
  personalContext: z.string(),
})
export type UserProfile = z.infer<typeof UserProfile>

/** What a client may write. It replaces the whole profile; empty strings clear a field. */
export const UserProfileUpdate = z.strictObject({
  name: z.string().trim().max(USER_NAME_MAX),
  personalContext: z.string().max(USER_CONTEXT_MAX),
})
export type UserProfileUpdate = z.infer<typeof UserProfileUpdate>
