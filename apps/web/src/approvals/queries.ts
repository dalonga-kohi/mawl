import type { Approval, ApprovalId } from '@mawl/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useApi } from '../api/ApiProvider.tsx'
import { keys } from '../api/keys.ts'

/** How many recent approvals the inbox and the chat read. */
export const RECENT_LIMIT = 50

/** Everything waiting on the owner. The event stream refetches it on every approval event. */
export function usePendingApprovals() {
  const { approvals } = useApi()
  const input = { status: 'pending' } as const
  return useQuery({ queryKey: keys.approvals(input), queryFn: () => approvals.list(input) })
}

/** The newest approvals in any status, pending ones included. */
export function useRecentApprovals() {
  const { approvals } = useApi()
  const input = { limit: RECENT_LIMIT }
  return useQuery({ queryKey: keys.approvals(input), queryFn: () => approvals.list(input) })
}

export function useDecideApproval() {
  const { approvals } = useApi()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: ApprovalId; decision: 'approve' | 'deny' }): Promise<Approval> =>
      approvals.decide(input),
    // A success and a CONFLICT both leave the lists stale: refetch for the true status.
    onSettled: () => client.invalidateQueries({ queryKey: keys.approvalsAll() }),
  })
}
