import type {
  ChatGptAttemptStatus,
  CredentialId,
  ProviderCredential,
  ProviderCredentialInput,
  ProviderDescriptor,
  ProviderTestInput,
  ProviderTestResult,
} from '@mawl/contracts'
import type { ProvidersApi } from '../api/providers-api.ts'

const caps = {
  supportsTools: true,
  supportsCaching: false,
  supportsContextEditing: false,
  supportsCompaction: false,
}

export const CATALOG: ProviderDescriptor[] = [
  {
    kind: 'anthropic',
    label: 'Anthropic',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    capabilities: caps,
  },
  {
    kind: 'openai',
    label: 'OpenAI',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: caps,
  },
  {
    kind: 'openrouter',
    label: 'OpenRouter',
    keyRequired: true,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    capabilities: caps,
  },
  {
    kind: 'ollama',
    label: 'Ollama',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'http://localhost:11434',
    capabilities: caps,
  },
  {
    kind: 'openai_compatible',
    label: 'OpenAI-compatible',
    keyRequired: false,
    baseUrlRequired: true,
    defaultBaseUrl: null,
    capabilities: caps,
  },
  {
    kind: 'openai_chatgpt',
    label: 'ChatGPT plan',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    capabilities: caps,
  },
  {
    kind: 'anthropic_claude_code',
    label: 'Claude plan',
    keyRequired: false,
    baseUrlRequired: false,
    defaultBaseUrl: null,
    capabilities: { ...caps, supportsTools: false },
  },
]

let seq = 0
const credId = () => `cred_01JTEST${String(++seq).padStart(19, '0')}` as CredentialId

export function credential(patch: Partial<ProviderCredential> = {}): ProviderCredential {
  return {
    id: credId(),
    provider: 'anthropic',
    label: 'Anthropic',
    baseUrl: null,
    accountEmail: null,
    planUsage: false,
    reauthRequired: false,
    createdAt: '2026-10-18T10:00:00.000Z',
    ...patch,
  }
}

export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

/** An in-memory ProvidersApi with call recording and scriptable answers. */
export function fakeProvidersApi(initial: ProviderCredential[] = []) {
  const state = {
    credentials: [...initial],
    listError: null as Error | null,
    testResults: new Map<string, ProviderTestResult>(),
    inlineTest: { ok: true, latencyMs: 120 } as
      | ProviderTestResult
      | ((target: Exclude<ProviderTestInput, { id: CredentialId }>) => ProviderTestResult),
    tested: [] as ProviderTestInput[],
    revoked: true,
    startError: null as Error | null,
    statuses: [] as ChatGptAttemptStatus[],
    created: [] as ProviderCredentialInput[],
    removed: [] as string[],
    createError: null as Error | null,
    statusError: null as Error | null,
    statusCalls: 0,
  }
  const api: ProvidersApi = {
    // Fast polling keeps the sign-in tests quick and independent of the real 1.5 s cadence.
    chatgptPollMs: 20,
    catalog: async () => CATALOG,
    list: async () => {
      if (state.listError) throw state.listError
      return [...state.credentials]
    },
    create: async (input) => {
      if (state.createError) throw state.createError
      state.created.push(input)
      const row = credential({
        provider: input.provider,
        label: input.label,
        baseUrl: input.baseUrl ?? null,
      })
      state.credentials.push(row)
      return row
    },
    remove: async (id) => {
      state.removed.push(id)
      const row = state.credentials.find((c) => c.id === id)
      if (!row) throw new ApiError('NOT_FOUND')
      state.credentials = state.credentials.filter((c) => c.id !== id)
      return { ...row, revoked: state.revoked }
    },
    test: async (target) => {
      state.tested.push(target)
      if ('id' in target) return state.testResults.get(target.id) ?? { ok: true, latencyMs: 87 }
      return typeof state.inlineTest === 'function' ? state.inlineTest(target) : state.inlineTest
    },
    chatgptStart: async () => {
      if (state.startError) throw state.startError
      return {
        attemptId: '7a2f1c3e-0b4d-4e8a-9f61-2c5d8e7b9a10',
        authorizeUrl: 'https://auth.openai.com/api/accounts/authorize?client_id=x',
      }
    },
    chatgptStatus: async () => {
      state.statusCalls++
      if (state.statusError) throw state.statusError
      const next = state.statuses.shift() ?? { status: 'pending' }
      if (next.status === 'succeeded') {
        state.credentials.push(
          credential({
            id: next.credentialId,
            provider: 'openai_chatgpt',
            label: 'ChatGPT',
            accountEmail: 'owner@example.com',
            planUsage: true,
          }),
        )
      }
      return next
    },
  }
  return { api, state }
}
