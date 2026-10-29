import { type Approval, contract, newId } from '@mawl/contracts'
import { call } from '@orpc/server'
import { describe, expect, it, vi } from 'vitest'
import {
  ApprovalConflictError,
  ApprovalNotFoundError,
  type ApprovalService,
} from './approvals/service.ts'
import { OWNER } from './auth/principal.ts'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'
import { unusedRuns } from './runs/test-util.ts'

const approval: Approval = {
  id: newId('approval'),
  profileId: newId('profile'),
  runId: newId('run'),
  stepIdx: 0,
  toolCallId: 'call_1',
  tool: 'web_fetch',
  argsRedacted: { url: 'https://a.example/?…' },
  actionClass: 'read',
  reason: 'First fetch to a.example in this run: the url can carry data out.',
  status: 'approved',
  decidedByDevice: null,
  decidedViaChannel: 'app',
  createdAt: '2026-10-29T10:00:00.000Z',
  expiresAt: '2026-10-30T10:00:00.000Z',
  decidedAt: '2026-10-29T10:01:00.000Z',
}

const unused: ApprovalService = {
  list: () => Promise.reject(new Error('not stubbed')),
  get: () => Promise.reject(new Error('not stubbed')),
  decide: () => Promise.reject(new Error('not stubbed')),
  expireDue: () => Promise.reject(new Error('not stubbed')),
}

function routerWith(over: Partial<ApprovalService>) {
  return createRouter({
    version: '1',
    providers: unusedProviders,
    runs: unusedRuns,
    approvals: { ...unused, ...over },
  })
}

const owner = { context: { principal: OWNER } }

describe('approvals procedures', () => {
  it('decide passes the decision with the app as the channel and returns the approval', async () => {
    const decide = vi.fn(async () => approval)
    const router = routerWith({ decide })
    const out = await call(router.approvals.decide, { id: approval.id, decision: 'approve' }, owner)
    expect(out).toEqual(approval)
    expect(decide).toHaveBeenCalledWith(approval.id, 'approve', { deviceId: null, via: 'app' })
    expect(contract.approvals.decide['~orpc'].outputSchema?.['~standard'].validate(out)).toEqual({
      value: approval,
    })
  })

  it('refuses every approvals procedure without the owner principal', async () => {
    const decide = vi.fn(async () => approval)
    const list = vi.fn(async () => [approval])
    const get = vi.fn(async () => approval)
    const router = routerWith({ decide, list, get })
    await expect(
      call(router.approvals.decide, { id: approval.id, decision: 'approve' }),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(call(router.approvals.list, undefined)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    await expect(call(router.approvals.get, { id: approval.id })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
    expect(decide).not.toHaveBeenCalled()
  })

  it('maps a missing approval to NOT_FOUND and a decided one to CONFLICT with its status', async () => {
    const router = routerWith({
      decide: async () => {
        throw new ApprovalConflictError('expired')
      },
      get: async (id) => {
        throw new ApprovalNotFoundError(id)
      },
    })
    await expect(
      call(router.approvals.decide, { id: approval.id, decision: 'deny' }, owner),
    ).rejects.toMatchObject({ code: 'CONFLICT', status: 409, data: { status: 'expired' } })
    await expect(call(router.approvals.get, { id: approval.id }, owner)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      data: { entity: 'approval', id: approval.id },
    })
  })

  it('list passes the filters through', async () => {
    const list = vi.fn(async () => [approval])
    const router = routerWith({ list })
    expect(await call(router.approvals.list, { status: 'pending', limit: 10 }, owner)).toEqual([
      approval,
    ])
    expect(list).toHaveBeenCalledWith({ status: 'pending', limit: 10 })
  })

  it('stays a 501 stub without an approval service', async () => {
    const router = createRouter({ version: '1', providers: unusedProviders, runs: unusedRuns })
    await expect(call(router.approvals.list, undefined, owner)).rejects.toMatchObject({
      status: 501,
    })
  })
})
