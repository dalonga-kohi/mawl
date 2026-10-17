import { describe, expect, it } from 'vitest'
import {
  ChatGptAttemptStatus,
  ChatGptSignInFailure,
  ChatGptStartResult,
  ProviderCredential,
  ProviderCredentialInput,
} from './entities'
import { ProviderFailureReason, ProviderKind } from './enums'
import * as f from './fixtures'
import { contract } from './router'

describe('openai_chatgpt provider kind', () => {
  it('is part of ProviderKind', () => {
    expect(ProviderKind.options).toContain('openai_chatgpt')
  })

  it('cannot be created from an input: credentials come only from the OAuth flow', () => {
    const r = ProviderCredentialInput.safeParse({
      provider: 'openai_chatgpt',
      label: 'Mine',
      secret: 'tok',
    })
    expect(r.success).toBe(false)
    expect(JSON.stringify(r.error?.issues)).toContain('Sign in with ChatGPT')
  })

  it('cannot be tested from an unsaved input either', async () => {
    const schema = contract.providers.test['~orpc'].inputSchema
    const res = await schema?.['~standard'].validate({ provider: 'openai_chatgpt', label: 'x' })
    expect(res).toHaveProperty('issues')
  })
})

describe('public credential shape for ChatGPT sign-in', () => {
  it('shows the owner email, plan usage and reauth state, and still refuses token keys', () => {
    const chatgpt = {
      ...f.providerCredential,
      provider: 'openai_chatgpt',
      accountEmail: 'owner@example.com',
      planUsage: true,
      reauthRequired: false,
    }
    expect(ProviderCredential.safeParse(chatgpt).success).toBe(true)
    for (const key of ['accessToken', 'refreshToken', 'idToken', 'clientId']) {
      expect(ProviderCredential.safeParse({ ...chatgpt, [key]: 'x' }).success).toBe(false)
    }
  })
})

describe('ProviderFailureReason', () => {
  it('is a closed enum of the plan-failure reasons', () => {
    expect([...ProviderFailureReason.options].sort()).toEqual(
      [
        'config_error',
        'not_eligible',
        'plan_limit_reached',
        'plan_usage_disabled',
        'provider_error',
        'reauth_required',
        'temporarily_unavailable',
        'unsupported_capability',
      ].sort(),
    )
  })
})

describe('providers.chatgpt contract', () => {
  it('start returns the attempt id and the authorize url, nothing else', () => {
    const ok = {
      attemptId: 'a3b1d3a0-5f3c-4d3e-8a55-0f1c2b3d4e5f',
      authorizeUrl: 'https://x.test/',
    }
    expect(ChatGptStartResult.safeParse(ok).success).toBe(true)
    expect(ChatGptStartResult.safeParse({ ...ok, state: 's' }).success).toBe(false)
  })

  it('status is pending, succeeded with a credential id, or failed with a closed reason', () => {
    expect(ChatGptAttemptStatus.safeParse({ status: 'pending' }).success).toBe(true)
    expect(
      ChatGptAttemptStatus.safeParse({
        status: 'succeeded',
        credentialId: 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8',
      }).success,
    ).toBe(true)
    for (const reason of ChatGptSignInFailure.options) {
      expect(ChatGptAttemptStatus.safeParse({ status: 'failed', reason }).success).toBe(true)
    }
    expect(ChatGptAttemptStatus.safeParse({ status: 'failed', reason: 'free text' }).success).toBe(
      false,
    )
  })

  it('exposes start and status procedures', () => {
    expect(Object.keys(contract.providers.chatgpt)).toEqual(['start', 'status'])
  })
})
