import type { ActionClass, ApprovalStatus, Json } from '@mawl/contracts'

/** What a tool call does, in the owner's words. */
export const ACTION_LABEL: Record<ActionClass, string> = {
  read: 'Read something',
  write_local: 'Change a file',
  send_message: 'Send a message',
  purchase: 'Spend money',
  delete: 'Delete something',
  credential: 'Use a credential',
  external_post: 'Post publicly',
  shell_exec: 'Run a command',
  owner_contact: 'Contact you',
}

export const STATUS_LABEL: Record<Exclude<ApprovalStatus, 'pending'>, string> = {
  approved: 'Approved',
  denied: 'Denied',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Time left before a pending approval resolves as expired. Rounds up, so it never says 0 min. */
export function expiryLabel(expiresAt: string, now: number): string {
  const left = Date.parse(expiresAt) - now
  if (left <= 0) return 'Expiring now'
  if (left < MINUTE) return 'Expires in under a minute'
  if (left < HOUR) return `Expires in ${Math.ceil(left / MINUTE)} min`
  if (left < DAY) return `Expires in ${Math.round(left / HOUR)} h`
  return `Expires in ${Math.round(left / DAY)} d`
}

const MAX_ARGS = 600

/** The redacted arguments as readable JSON, cut short when long. */
export function argsText(args: Record<string, Json>): string {
  const text = JSON.stringify(args, null, 2)
  return text.length > MAX_ARGS ? `${text.slice(0, MAX_ARGS)}…` : text
}
