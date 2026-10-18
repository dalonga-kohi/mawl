import type {
  ArtifactId,
  CredentialId,
  Json,
  MessageId,
  MessagePart,
  ProfileId,
  RunBudget,
  RunId,
  StepId,
  ThreadId,
  Usage,
} from '@faire/contracts'
import {
  ChannelKind,
  MessageRole,
  ProviderKind,
  RunStatus,
  RunTrigger,
  StepKind,
} from '@faire/contracts'
import { type SQL, sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core'

// --- Enums: values come from the contracts zod enums so the two cannot drift. ---

export const runStatus = pgEnum('run_status', RunStatus.enum)
export const runTrigger = pgEnum('run_trigger', RunTrigger.enum)
export const stepKind = pgEnum('step_kind', StepKind.enum)
export const messageRole = pgEnum('message_role', MessageRole.enum)
export const providerKind = pgEnum('provider_kind', ProviderKind.enum)

/** Where a thread came from. Stored as text with a CHECK so channels can grow without ALTER TYPE. */
export const ORIGINS = ['app', ...ChannelKind.options] as const

// --- Column helpers ---

/** Raw bytes. Node's pg driver returns Buffer (a Uint8Array); PGlite returns Uint8Array. */
const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
})

/**
 * jsonb holding an arbitrary JSON value. Not drizzle's built-in jsonb: that one JSON.parses string
 * results a second time (the driver already parsed), corrupting a JSON string like the string "null".
 */
const jsonbValue = customType<{ data: Json; driverData: string }>({
  dataType: () => 'jsonb',
  toDriver: (v) => JSON.stringify(v),
  fromDriver: (v) => v as unknown as Json,
})

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * Write wrapper for NOT NULL jsonb columns typed Json (run_steps.input_json, events.payload_json).
 * Drizzle maps a JS null to SQL NULL before any column mapper runs, so a JSON null must be
 * written as the jsonb value 'null'. Always pass those columns through this.
 * Reads need nothing: jsonb 'null' comes back as null.
 */
export function jsonValue(value: Json): Json | SQL {
  return value === null ? sql`'null'::jsonb` : value
}

// --- Tables ---

export const profiles = pgTable('profiles', {
  id: text('id').$type<ProfileId>().primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  color: text('color').notNull(),
  personaMd: text('persona_md').notNull().default(''),
  modelMain: text('model_main').notNull(),
  modelHelper: text('model_helper'),
  policy: jsonb('policy_json').$type<Record<string, unknown>>().notNull().default({}),
  heartbeatCron: text('heartbeat_cron'),
  createdAt: createdAt(),
  archivedAt: ts('archived_at'),
})

/** `secretEnc` holds ciphertext only. Its format is the server's concern; never add a plaintext column. */
export const providerCredentials = pgTable('provider_credentials', {
  id: text('id').$type<CredentialId>().primaryKey(),
  provider: providerKind('provider').notNull(),
  label: text('label').notNull(),
  secretEnc: bytea('secret_enc').notNull(),
  baseUrl: text('base_url'),
  /** Sign in with ChatGPT: the owner's own account email, shown in the app. Null for API keys. */
  accountEmail: text('account_email'),
  /** Sign in with ChatGPT: false when the grant lacks plan usage. */
  planUsage: boolean('plan_usage').notNull().default(false),
  /** Sign in with ChatGPT: tokens were cleared by a terminal refresh error. */
  reauthRequired: boolean('reauth_required').notNull().default(false),
  /** The issued OAuth client behind a signed-in credential. At most one credential per client. */
  oauthClientId: text('oauth_client_id')
    .unique()
    .references(() => oauthClients.clientId),
  createdAt: createdAt(),
})

/**
 * OAuth clients that a provider issued to this server (Sign in with ChatGPT hands out an
 * oaiapp_... id on first sign-in). Kept when a credential is deleted, so the next sign-in
 * reuses the registration. The id is public, not a secret.
 */
export const oauthClients = pgTable(
  'oauth_clients',
  {
    clientId: text('client_id').primaryKey(),
    provider: providerKind('provider').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('oauth_clients_provider_created_idx').on(t.provider, t.createdAt.desc())],
)

export const threads = pgTable(
  'threads',
  {
    id: text('id').$type<ThreadId>().primaryKey(),
    profileId: text('profile_id')
      .$type<ProfileId>()
      .notNull()
      .references(() => profiles.id),
    channel: text('channel').$type<(typeof ORIGINS)[number]>().notNull(),
    peer: text('peer'),
    title: text('title'),
    createdAt: createdAt(),
    lastEventAt: ts('last_event_at'),
  },
  (t) => [
    check(
      'threads_channel_check',
      sql`${t.channel} in (${sql.raw(ORIGINS.map((o) => `'${o}'`).join(', '))})`,
    ),
    index('threads_profile_last_event_idx').on(t.profileId, t.lastEventAt.desc().nullsLast()),
  ],
)

export const runs = pgTable(
  'runs',
  {
    id: text('id').$type<RunId>().primaryKey(),
    profileId: text('profile_id')
      .$type<ProfileId>()
      .notNull()
      .references(() => profiles.id),
    threadId: text('thread_id')
      .$type<ThreadId>()
      .references(() => threads.id),
    trigger: runTrigger('trigger').notNull(),
    status: runStatus('status').notNull().default('queued'),
    budget: jsonb('budget_json').$type<RunBudget>().notNull().default({}),
    usage: jsonb('usage_json')
      .$type<Usage>()
      .notNull()
      .default({ inputTokens: 0, outputTokens: 0 }),
    segmentNo: integer('segment_no').notNull().default(0),
    createdAt: createdAt(),
    startedAt: ts('started_at'),
    endedAt: ts('ended_at'),
    error: text('error'),
  },
  (t) => [
    check('runs_segment_no_check', sql`${t.segmentNo} >= 0`),
    index('runs_profile_status_idx').on(t.profileId, t.status),
    index('runs_thread_idx').on(t.threadId),
  ],
)

export const messages = pgTable(
  'messages',
  {
    id: text('id').$type<MessageId>().primaryKey(),
    threadId: text('thread_id')
      .$type<ThreadId>()
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .$type<RunId>()
      .references(() => runs.id, { onDelete: 'set null' }),
    role: messageRole('role').notNull(),
    parts: jsonb('parts_json').$type<MessagePart[]>().notNull(),
    tokenCount: integer('token_count'),
    createdAt: createdAt(),
  },
  (t) => [
    check('messages_token_count_check', sql`${t.tokenCount} is null or ${t.tokenCount} >= 0`),
    index('messages_thread_created_idx').on(t.threadId, t.createdAt),
  ],
)

export const runSteps = pgTable(
  'run_steps',
  {
    id: text('id').$type<StepId>().primaryKey(),
    runId: text('run_id')
      .$type<RunId>()
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    idx: integer('idx').notNull(),
    kind: stepKind('kind').notNull(),
    input: jsonbValue('input_json').notNull(),
    outputRef: text('output_ref'),
    usage: jsonb('usage_json').$type<Usage>(),
    createdAt: createdAt(),
  },
  (t) => [
    // Job dedupe rule: a step index is written at most once per run. Also serves run_id lookups.
    unique('run_steps_run_idx_unique').on(t.runId, t.idx),
    check('run_steps_idx_check', sql`${t.idx} >= 0`),
  ],
)

export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').$type<ArtifactId>().primaryKey(),
    profileId: text('profile_id')
      .$type<ProfileId>()
      .notNull()
      .references(() => profiles.id),
    runId: text('run_id')
      .$type<RunId>()
      .references(() => runs.id, { onDelete: 'set null' }),
    mime: text('mime').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    preview: text('preview').notNull(),
    tokenCount: integer('token_count').notNull(),
    /** Inline bytes, or null when the body lives on disk at `path`. Exactly one is set. */
    content: bytea('content'),
    path: text('path'),
    createdAt: createdAt(),
  },
  (t) => [
    check(
      'artifacts_content_xor_path_check',
      sql`(${t.content} is not null) <> (${t.path} is not null)`,
    ),
    check('artifacts_size_bytes_check', sql`${t.sizeBytes} >= 0`),
    check('artifacts_token_count_check', sql`${t.tokenCount} >= 0`),
    index('artifacts_run_idx').on(t.runId),
  ],
)

/**
 * Feed, WebSocket resume and audit log. `id` is bigserial in `number` mode: 2^53 events is
 * far beyond a self-hosted install's lifetime, and a number is what the wire `since` cursor is.
 */
export const events = pgTable(
  'events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    profileId: text('profile_id')
      .$type<ProfileId>()
      .references(() => profiles.id),
    runId: text('run_id')
      .$type<RunId>()
      .references(() => runs.id, { onDelete: 'set null' }),
    type: text('type').notNull(),
    payload: jsonbValue('payload_json').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('events_profile_id_idx').on(t.profileId, t.id),
    index('events_run_id_idx').on(t.runId, t.id),
  ],
)

/**
 * The only columns a repository may select for public (API) reads of credentials. Maps 1:1 onto
 * contracts ProviderCredential. Never select secretEnc outside the server's decrypt path.
 */
export const providerCredentialPublicColumns = {
  id: providerCredentials.id,
  provider: providerCredentials.provider,
  label: providerCredentials.label,
  baseUrl: providerCredentials.baseUrl,
  accountEmail: providerCredentials.accountEmail,
  planUsage: providerCredentials.planUsage,
  reauthRequired: providerCredentials.reauthRequired,
  createdAt: providerCredentials.createdAt,
}
