import type { Approval, ApprovalId, ApprovalStatus } from '@mawl/contracts'

export interface ApprovalListInput {
  status?: ApprovalStatus
  limit?: number
}

/**
 * What the approvals views need from `approvals.*` (owner only). A failed decision carries the
 * oRPC `code`; `CONFLICT` also carries `data.status`, the approval's true status.
 */
export interface ApprovalsApi {
  /** Newest first. */
  list(input: ApprovalListInput): Promise<Approval[]>
  decide(input: { id: ApprovalId; decision: 'approve' | 'deny' }): Promise<Approval>
}

/**
 * The true status a CONFLICT answer carries, when it carries a settled one. `pending` is not one:
 * a conflict that claims the approval is still pending is a server fault, treated as a failure.
 */
export function conflictStatus(error: unknown): ApprovalStatus | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  if ((error as { code?: unknown }).code !== 'CONFLICT') return undefined
  const data = (error as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return undefined
  const status = (data as { status?: unknown }).status
  const known = ['approved', 'denied', 'expired', 'cancelled']
  return typeof status === 'string' && known.includes(status)
    ? (status as ApprovalStatus)
    : undefined
}
