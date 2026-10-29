import type { Approval, ApprovalId, ProfileId, RunId } from '@mawl/contracts'
import type { QueryClient } from '@tanstack/react-query'
import type { ApprovalListInput, ApprovalsApi } from '../api/approvals-api.ts'

let seq = 0
const ulid = () => `01JTEST${String(++seq).padStart(19, '0')}`
const NOW = '2026-10-18T10:00:00.000Z'

export function approval(patch: Partial<Approval> = {}): Approval {
  return {
    id: `appr_${ulid()}` as ApprovalId,
    profileId: `prof_${ulid()}` as ProfileId,
    runId: `run_${ulid()}` as RunId,
    stepIdx: 0,
    toolCallId: `call_${seq}`,
    tool: 'send_email',
    argsRedacted: { to: 'sam@example.com', subject: 'Lunch?' },
    actionClass: 'send_message',
    reason: 'Sending a message to someone outside Mawl needs your OK.',
    status: 'pending',
    decidedByDevice: null,
    decidedViaChannel: null,
    createdAt: NOW,
    expiresAt: '2026-10-18T10:30:00.000Z',
    decidedAt: null,
    ...patch,
  }
}

/** An error shaped like an oRPC one: a `code` and optional `data`. */
export class FakeRpcError extends Error {
  constructor(
    readonly code: string,
    readonly data?: unknown,
  ) {
    super(code)
  }
}

/** An in-memory ApprovalsApi with call recording and scriptable answers. */
export function fakeApprovalsApi(initial: Approval[] = []) {
  const state = {
    items: [...initial],
    decided: [] as { id: ApprovalId; decision: 'approve' | 'deny' }[],
    listError: null as Error | null,
    /** When set, list waits for it before answering (a load in flight). */
    listGate: null as Promise<void> | null,
    decideError: null as Error | null,
    /** When set, decide waits for it before answering (a decision in flight). */
    decideGate: null as Promise<void> | null,
    listCalls: 0,
  }
  let queryClient: QueryClient | undefined

  const api: ApprovalsApi = {
    list: async (input: ApprovalListInput) => {
      state.listCalls++
      if (state.listGate) await state.listGate
      if (state.listError) throw state.listError
      return state.items
        .filter((a) => !input.status || a.status === input.status)
        .slice(0, input.limit ?? 100)
    },
    decide: async ({ id, decision }) => {
      if (state.decideGate) await state.decideGate
      state.decided.push({ id, decision })
      if (state.decideError) throw state.decideError
      const row = state.items.find((a) => a.id === id)
      if (!row) throw new FakeRpcError('NOT_FOUND')
      if (row.status !== 'pending') throw new FakeRpcError('CONFLICT', { status: row.status })
      row.status = decision === 'approve' ? 'approved' : 'denied'
      row.decidedAt = NOW
      return { ...row }
    },
  }

  return {
    api,
    state,
    /** Lets the fake reach the app's query cache, like the event store does. */
    attach(client: QueryClient) {
      queryClient = client
    },
    /** Changes a row behind the app's back, then invalidates like an `approval.*` event. */
    async server(id: ApprovalId, patch: Partial<Approval>) {
      const row = state.items.find((a) => a.id === id)
      if (row) Object.assign(row, patch)
      await queryClient?.invalidateQueries({ queryKey: [['approvals'], {}] })
    },
  }
}
