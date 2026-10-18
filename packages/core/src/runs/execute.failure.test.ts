import { describe, expect, it, vi } from 'vitest'
import { ProviderFailureError } from '../providers/failure.ts'
import { ModelNotConfiguredError } from './errors.ts'
import { executeRun } from './execute.ts'
import { setup } from './test-util.ts'

describe('executeRun: failures', () => {
  it('fails with the provider reason when the stream ends in a provider failure', async () => {
    const { store, runId, deps } = setup([
      { text: 'partial', streamError: new ProviderFailureError('plan_limit_reached') },
    ])

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'failed', error: 'plan_limit_reached' })
    expect(store.statuses(runId)).toEqual(['running', 'failed'])
    expect(store.runs.get(runId)).toMatchObject({ status: 'failed', error: 'plan_limit_reached' })
    expect(store.events.at(-1)?.payload).toMatchObject({
      status: 'failed',
      error: 'plan_limit_reached',
    })
    // A failed step is not persisted and no assistant message is written.
    expect(await store.steps(runId)).toHaveLength(0)
    expect(store.thread.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })

  it('fails with the provider reason when the call itself rejects', async () => {
    const { deps } = setup([{ error: new ProviderFailureError('reauth_required') }])
    expect(await executeRun(deps)).toEqual({ outcome: 'failed', error: 'reauth_required' })
  })

  it('maps an unknown error to internal_error and stores none of its text', async () => {
    const onFailure = vi.fn()
    const { store, runId, deps } = setup(
      [{ error: new Error('401 for key sk-live-SECRET at https://10.0.0.5') }],
      { onFailure },
    )

    const out = await executeRun(deps)

    expect(out).toEqual({ outcome: 'failed', error: 'internal_error' })
    const everything = JSON.stringify([...store.runs.values(), store.events, store.thread])
    expect(everything).not.toContain('SECRET')
    expect(everything).not.toContain('10.0.0.5')
    expect(onFailure).toHaveBeenCalledWith({ runId, code: 'internal_error', errName: 'Error' })
    expect(JSON.stringify(onFailure.mock.calls)).not.toContain('SECRET')
  })

  it('fails model_not_configured when the model cannot be resolved, after queued to running', async () => {
    const { store, runId, deps, model } = setup([{ text: 'unused' }], {
      resolveModel: async () => {
        throw new ModelNotConfiguredError()
      },
    })
    const out = await executeRun(deps)
    expect(out).toEqual({ outcome: 'failed', error: 'model_not_configured' })
    expect(store.statuses(runId)).toEqual(['running', 'failed'])
    expect(model.calls).toHaveLength(0)
  })

  it('fails with config_error when resolving the model raises that provider failure', async () => {
    const { deps } = setup([{ text: 'unused' }], {
      resolveModel: async () => {
        throw new ProviderFailureError('config_error')
      },
    })
    expect(await executeRun(deps)).toEqual({ outcome: 'failed', error: 'config_error' })
  })

  it('lets infrastructure errors from the store propagate so the job can retry', async () => {
    const { store, deps } = setup([{ text: 'ok' }])
    vi.spyOn(store, 'appendStep').mockRejectedValue(new Error('connection terminated'))
    await expect(executeRun(deps)).rejects.toThrow('connection terminated')
  })
})
