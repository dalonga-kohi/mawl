import { z } from 'zod'

/** Entity kinds that carry a branded, prefixed id. */
export const ID_KINDS = [
  'profile',
  'credential',
  'thread',
  'message',
  'run',
  'step',
  'artifact',
  'approval',
  'routine',
  'mcpServer',
  'channel',
  'device',
  'rule',
] as const
export type IdKind = (typeof ID_KINDS)[number]

export const ID_PREFIX = {
  profile: 'prof',
  credential: 'cred',
  thread: 'thr',
  message: 'msg',
  run: 'run',
  step: 'step',
  artifact: 'art',
  approval: 'appr',
  routine: 'rtn',
  mcpServer: 'mcp',
  channel: 'chan',
  device: 'dev',
  rule: 'rule',
} as const satisfies Record<IdKind, string>

/** Crockford base32 ULID body (no I, L, O, U). */
const ULID_BODY = '[0-9A-HJKMNP-TV-Z]{26}'

const patterns = Object.fromEntries(
  ID_KINDS.map((k) => [k, new RegExp(`^${ID_PREFIX[k]}_${ULID_BODY}$`)]),
) as Record<IdKind, RegExp>

export function idSchema<K extends IdKind>(kind: K) {
  return z
    .string()
    .regex(patterns[kind], `expected ${ID_PREFIX[kind]}_<ULID>`)
    .brand<K>()
}

export const ProfileId = idSchema('profile')
export const CredentialId = idSchema('credential')
export const ThreadId = idSchema('thread')
export const MessageId = idSchema('message')
export const RunId = idSchema('run')
export const StepId = idSchema('step')
export const ArtifactId = idSchema('artifact')
export const ApprovalId = idSchema('approval')
export const RoutineId = idSchema('routine')
export const McpServerId = idSchema('mcpServer')
export const ChannelId = idSchema('channel')
export const DeviceId = idSchema('device')
export const RuleId = idSchema('rule')

export type ProfileId = z.infer<typeof ProfileId>
export type CredentialId = z.infer<typeof CredentialId>
export type ThreadId = z.infer<typeof ThreadId>
export type MessageId = z.infer<typeof MessageId>
export type RunId = z.infer<typeof RunId>
export type StepId = z.infer<typeof StepId>
export type ArtifactId = z.infer<typeof ArtifactId>
export type ApprovalId = z.infer<typeof ApprovalId>
export type RoutineId = z.infer<typeof RoutineId>
export type McpServerId = z.infer<typeof McpServerId>
export type ChannelId = z.infer<typeof ChannelId>
export type DeviceId = z.infer<typeof DeviceId>
export type RuleId = z.infer<typeof RuleId>

/** True when `value` is a well-formed id of the given kind. */
export function isId(kind: IdKind, value: unknown): boolean {
  return typeof value === 'string' && patterns[kind].test(value)
}
