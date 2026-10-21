import { type CredentialId, newId, type ProfileId, type ProviderCredential } from '@mawl/contracts'
import { ModelNotConfiguredError, ProviderFailureError, type RunRecord } from '@mawl/core'
import { fakeModel } from '@mawl/testkit'
import { describe, expect, it, vi } from 'vitest'
import { CredentialNotFoundError, CredentialUnreadableError } from '../providers/types.ts'
import { createModelResolver } from './resolve-model.ts'

const cred = (provider: ProviderCredential['provider']): ProviderCredential => ({
  id: newId('credential'),
  provider,
  label: 'k',
  baseUrl: null,
  accountEmail: null,
  planUsage: false,
  reauthRequired: false,
  createdAt: '2026-01-02T03:04:05.000Z',
})
const run = {} as RunRecord
const profile = (modelMain: string) => ({
  id: newId('profile') as ProfileId,
  personaMd: '',
  modelMain,
})

function providers(creds: ProviderCredential[], createModel = vi.fn(async () => fakeModel([]))) {
  return { list: async () => creds, createModel }
}

describe('createModelResolver', () => {
  it('builds the model for the credential named in the ref and reports tool support', async () => {
    const c = cred('anthropic')
    const model = fakeModel([])
    const p = providers(
      [c],
      vi.fn(async () => model),
    )
    const resolved = await createModelResolver(p)(run, profile(`${c.id}:claude-x:y`))
    expect(resolved).toEqual({ model, supportsTools: true })
    expect(p.createModel).toHaveBeenCalledWith(c.id, 'claude-x:y')
  })

  it('turns tools off for a provider that cannot use them', async () => {
    const c = cred('anthropic_claude_code')
    const resolved = await createModelResolver(providers([c]))(run, profile(`${c.id}:sonnet`))
    expect(resolved.supportsTools).toBe(false)
  })

  it.each([
    ['an unparseable ref', 'anthropic:claude'],
    ['an empty ref', ''],
  ])('fails model_not_configured for %s', async (_n, ref) => {
    await expect(createModelResolver(providers([]))(run, profile(ref))).rejects.toBeInstanceOf(
      ModelNotConfiguredError,
    )
  })

  it('fails model_not_configured when the credential does not exist', async () => {
    const missing = newId('credential') as CredentialId
    await expect(
      createModelResolver(providers([cred('openai')]))(run, profile(`${missing}:gpt`)),
    ).rejects.toBeInstanceOf(ModelNotConfiguredError)
  })

  it('maps a credential deleted between lookup and build to model_not_configured', async () => {
    const c = cred('openai')
    const p = providers(
      [c],
      vi.fn(async () => {
        throw new CredentialNotFoundError(c.id)
      }),
    )
    await expect(createModelResolver(p)(run, profile(`${c.id}:gpt`))).rejects.toBeInstanceOf(
      ModelNotConfiguredError,
    )
  })

  it('maps an unreadable credential to the config_error provider failure', async () => {
    const c = cred('openai')
    const p = providers(
      [c],
      vi.fn(async () => {
        throw new CredentialUnreadableError(c.id)
      }),
    )
    await expect(createModelResolver(p)(run, profile(`${c.id}:gpt`))).rejects.toMatchObject({
      name: 'ProviderFailureError',
      reason: 'config_error',
    })
    expect(ProviderFailureError).toBeDefined()
  })

  it('lets provider failures from model creation through unchanged', async () => {
    const c = cred('openai_chatgpt')
    const failure = new ProviderFailureError('reauth_required')
    const p = providers(
      [c],
      vi.fn(async () => {
        throw failure
      }),
    )
    await expect(createModelResolver(p)(run, profile(`${c.id}:gpt`))).rejects.toBe(failure)
  })
})
