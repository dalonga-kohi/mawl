import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { ProviderTestResult } from '@mawl/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderFailureError } from '../failure.ts'
import { testClaudeCodeLogin } from './auth-status.ts'
import { buildClaudeEnv } from './env.ts'
import { failureForAssistantError, failureForRateLimit } from './errors.ts'
import { __resetClaudeLoginCache, createClaudeCodeModel } from './model.ts'
import { fakeQuery, msg } from './test-util.ts'

const userPrompt = (text: string): LanguageModelV4CallOptions => ({
  prompt: [{ role: 'user', content: [{ type: 'text', text }] }],
})

const happy = () => [
  msg.start(),
  msg.blockStart(0),
  msg.textDelta(0, 'Hello'),
  msg.blockStop(0),
  msg.success(),
]

const okLogin = async (): Promise<ProviderTestResult> => ({ ok: true, latencyMs: 1 })

const model = (
  extra: Partial<Parameters<typeof createClaudeCodeModel>[0]> = {},
  fq = fakeQuery(happy()),
) => createClaudeCodeModel({ modelId: 'sonnet', query: fq.query, checkLogin: okLogin, ...extra })

const failureOf = async (p: PromiseLike<unknown>) => {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(ProviderFailureError)
  return err as ProviderFailureError
}

beforeEach(() => __resetClaudeLoginCache())
afterEach(() => vi.unstubAllEnvs())

describe('claude login gate (hardening)', () => {
  it('turns a throwing login check into provider_error without its text, and starts no query', async () => {
    const fq = fakeQuery(happy())
    const checkLogin = vi.fn(async (): Promise<ProviderTestResult> => {
      throw new Error('spawn failed: token sk-ant-LEAK in /home/owner/.claude')
    })
    const err = await failureOf(model({ checkLogin }, fq).doGenerate(userPrompt('hi')))
    expect(err.reason).toBe('provider_error')
    expect(JSON.stringify(err)).not.toContain('LEAK')
    expect(err.message).not.toContain('LEAK')
    expect(String(err.cause ?? '')).not.toContain('LEAK')
    expect(fq.calls).toHaveLength(0)
  })

  it('checks again after a throwing check: the failure is neither cached nor left in flight', async () => {
    const checkLogin = vi
      .fn<() => Promise<ProviderTestResult>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: true, latencyMs: 1 })
    const m = model({ checkLogin })
    await failureOf(m.doGenerate(userPrompt('hi')))
    await m.doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })

  it.each(['rate_limited', 'invalid_key'] as const)(
    'maps a %s login check to provider_error and starts no query',
    async (reason) => {
      const fq = fakeQuery(happy())
      const checkLogin = vi.fn(async (): Promise<ProviderTestResult> => ({ ok: false, reason }))
      const err = await failureOf(model({ checkLogin }, fq).doGenerate(userPrompt('hi')))
      expect(err.reason).toBe('provider_error')
      expect(fq.calls).toHaveLength(0)
    },
  )

  it('keeps separate login results per binary path, not only per config dir', async () => {
    const checkLogin = vi.fn(okLogin)
    await model({ checkLogin, pathToClaudeCodeExecutable: '/opt/a' }).doGenerate(userPrompt('hi'))
    await model({ checkLogin, pathToClaudeCodeExecutable: '/opt/b' }).doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })

  it('lets the same binary path and config dir share one result', async () => {
    const checkLogin = vi.fn(okLogin)
    const same = { checkLogin, pathToClaudeCodeExecutable: '/opt/a', configDir: '/c' }
    await model(same).doGenerate(userPrompt('hi'))
    await model(same).doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(1)
  })

  it('a warning-level rate limit event does not fail the call', async () => {
    const fq = fakeQuery([msg.rateLimit('allowed_warning', 1_800_000_090), ...happy()])
    const result = await model({}, fq).doGenerate(userPrompt('hi'))
    expect(result.finishReason.unified).toBe('stop')
  })

  it('a rejected rate limit without a reset time is a plan limit with no wait', async () => {
    const fq = fakeQuery([msg.rateLimit('rejected'), ...happy()])
    const err = await failureOf(model({}, fq).doGenerate(userPrompt('hi')))
    expect(err.reason).toBe('plan_limit_reached')
    expect(err.retryAfter).toBeUndefined()
  })

  it('a rejected rate limit with a reset in the past waits 0 seconds, not a negative time', async () => {
    const fq = fakeQuery([msg.rateLimit('rejected', 1_700_000_000), ...happy()])
    const err = await failureOf(
      model({ now: () => 1_800_000_000_000 }, fq).doGenerate(userPrompt('hi')),
    )
    expect(err.retryAfter).toBe(0)
  })

  it('does not reuse a cached ok after the clock moves backwards past nothing: ttl is measured from the check', async () => {
    let t = 10_000_000
    const checkLogin = vi.fn(okLogin)
    const make = () => model({ checkLogin, now: () => t })
    await make().doGenerate(userPrompt('hi'))
    t += 5 * 60_000 - 1
    await make().doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(1)
    t += 1
    await make().doGenerate(userPrompt('hi'))
    expect(checkLogin).toHaveBeenCalledTimes(2)
  })
})

describe('claude failure mapping (hardening)', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf'])(
    'maps the prototype name %s to provider_error',
    (code) => {
      expect(failureForAssistantError(code).reason).toBe('provider_error')
    },
  )

  it('rounds a partial second of wait up, never down', () => {
    const now = () => 1_800_000_000_000
    expect(failureForRateLimit({ resetsAt: 1_800_000_090.5 }, now).retryAfter).toBe(91)
    expect(failureForRateLimit({ resetsAt: 1_800_000_000.2 }, now).retryAfter).toBe(1)
  })

  it('reads exactly 1e11 as milliseconds, and just below it as seconds', () => {
    const now = () => 0
    expect(failureForRateLimit({ resetsAt: 100_000_000_000 }, now).retryAfter).toBe(100_000_000)
    expect(failureForRateLimit({ resetsAt: 99_999_999_999 }, now).retryAfter).toBe(99_999_999_999)
  })
})

describe('claude login status (hardening)', () => {
  const base = { resolveBinary: () => '/opt/claude', now: () => 0 }
  const runner = (stdout: string) => ({ run: async () => ({ stdout }) })

  it('refuses a claude.ai method that says it is not logged in', async () => {
    const res = await testClaudeCodeLogin({
      ...base,
      ...runner(JSON.stringify({ authMethod: 'claude.ai', loggedIn: false })),
    })
    expect(res).toEqual({ ok: false, reason: 'not_signed_in' })
  })

  it.each(['claude.ai-enterprise', 'claude.ai ', 'Claude.ai', 'claude', 'claude.aix', ''])(
    'accepts only the exact claude.ai method, not %j',
    async (authMethod) => {
      const res = await testClaudeCodeLogin({
        ...base,
        ...runner(JSON.stringify({ authMethod, loggedIn: true })),
      })
      expect(res).toEqual({ ok: false, reason: 'wrong_auth_method' })
    },
  )

  it.each(['null', '[]', '"claude.ai"', '{"authMethod":5}', '{"loggedIn":true}', ''])(
    'reads stdout %j as an unexpected response',
    async (stdout) => {
      expect(await testClaudeCodeLogin({ ...base, ...runner(stdout) })).toEqual({
        ok: false,
        reason: 'unexpected_response',
      })
    },
  )

  it('leaves no timer behind after a quick answer', async () => {
    vi.useFakeTimers()
    try {
      const res = await testClaudeCodeLogin({
        ...base,
        ...runner(JSON.stringify({ authMethod: 'claude.ai', loggedIn: true })),
      })
      expect(res.ok).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leaves no timer behind after a failing run either', async () => {
    vi.useFakeTimers()
    try {
      const res = await testClaudeCodeLogin({
        ...base,
        run: async () => {
          throw new Error('nope')
        },
      })
      expect(res).toEqual({ ok: false, reason: 'unreachable' })
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not raise an unhandled rejection when the binary fails after the deadline', async () => {
    vi.useFakeTimers()
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      let fail!: (e: Error) => void
      const pending = testClaudeCodeLogin({
        ...base,
        timeoutMs: 1000,
        run: () =>
          new Promise((_, reject) => {
            fail = reject
          }),
      })
      await vi.advanceTimersByTimeAsync(1000)
      expect(await pending).toEqual({ ok: false, reason: 'unreachable' })
      fail(new Error('late'))
      vi.useRealTimers()
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
      vi.useRealTimers()
    }
  })

  it('passes the allowlisted env to the runner even when asked with a lower-case credential name', async () => {
    let seen: Record<string, string> = {}
    await testClaudeCodeLogin({
      ...base,
      env: {
        anthropic_api_key: 'sk-ant-x',
        Anthropic_Auth_Token: 'tok',
        claude_code_oauth_token: 'oat',
        PATH: '/bin',
      },
      run: async (_c, _a, o) => {
        seen = o.env
        return { stdout: JSON.stringify({ authMethod: 'claude.ai' }) }
      },
    })
    expect(seen).toEqual({ PATH: '/bin' })
  })
})

describe('claude env allowlist (hardening)', () => {
  it('drops credential names in any case', () => {
    const env = buildClaudeEnv({
      env: {
        anthropic_api_key: 'a',
        Anthropic_Auth_Token: 'b',
        claude_code_oauth_token: 'c',
        Claude_Code_Use_Bedrock: '1',
        ANTHROPIC_CUSTOM_HEADERS: 'x',
        PATH: '/bin',
      },
    })
    expect(env).toEqual({ PATH: '/bin' })
  })

  it('replaces an inherited config dir spelled in another case instead of keeping both', () => {
    const env = buildClaudeEnv({
      env: { Claude_Config_Dir: '/inherited', claude_config_dir: '/other' },
      configDir: '/data/claude',
    })
    expect(env).toEqual({ CLAUDE_CONFIG_DIR: '/data/claude' })
  })

  it('does not copy the process env by reference', () => {
    const source = { PATH: '/bin' }
    const env = buildClaudeEnv({ env: source })
    env.PATH = '/changed'
    expect(source.PATH).toBe('/bin')
  })
})
