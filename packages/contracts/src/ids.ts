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
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** First char 0-7: the 48-bit millisecond timestamp occupies 10 chars. */
const ULID_BODY = '[0-7][0-9A-HJKMNP-TV-Z]{25}'

const patterns = Object.fromEntries(
  ID_KINDS.map((k) => [k, new RegExp(`^${ID_PREFIX[k]}_${ULID_BODY}$`)]),
) as Record<IdKind, RegExp>

export function idSchema<K extends IdKind>(kind: K) {
  return z.string().regex(patterns[kind], `expected ${ID_PREFIX[kind]}_<ULID>`).brand<K>()
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

export interface NewIdOptions {
  /** Clock in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number
  /** Entropy source returning a float in [0, 1). Defaults to `crypto.getRandomValues`. */
  random?: () => number
}

const cryptoRandom = () => {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return (buf[0] as number) / 2 ** 32
}

let lastTime = -1
let lastRandom: number[] = []

/**
 * Mint a fresh `<prefix>_<ULID>`. Ids are lexicographically time-ordered and strictly
 * monotonic within a process: within the same millisecond (or if the clock steps back)
 * the previous random part is incremented instead of redrawn.
 */
export function newId<K extends IdKind>(kind: K, opts: NewIdOptions = {}): z.infer<ReturnType<typeof idSchema<K>>> {
  const now = opts.now ?? Date.now
  const random = opts.random ?? cryptoRandom
  let time = Math.floor(now())
  if (time <= lastTime && lastRandom.length === 16) {
    time = lastTime
    let i = 15
    while (i >= 0 && lastRandom[i] === 31) {
      lastRandom[i] = 0
      i--
    }
    if (i >= 0) lastRandom[i] = (lastRandom[i] as number) + 1
    else time += 1 // random part exhausted: borrow from the timestamp
    if (i < 0) lastRandom = Array.from({ length: 16 }, () => Math.floor(random() * 32))
  } else {
    lastRandom = Array.from({ length: 16 }, () => Math.floor(random() * 32))
  }
  lastTime = time
  let ts = ''
  for (let t = time, n = 0; n < 10; n++, t = Math.floor(t / 32)) ts = ALPHABET[t % 32] + ts
  const body = lastRandom.map((d) => ALPHABET[d]).join('')
  return `${ID_PREFIX[kind]}_${ts}${body}` as z.infer<ReturnType<typeof idSchema<K>>>
}