import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeQuery, msg } from './test-util.ts'

const testClaudeCodeLogin = vi.hoisted(() => vi.fn())
vi.mock('./auth-status.ts', () => ({ testClaudeCodeLogin }))

const { __resetClaudeLoginCache, createClaudeCodeModel } = await import('./model.ts')

const prompt: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

beforeEach(() => {
  __resetClaudeLoginCache()
  testClaudeCodeLogin.mockReset()
  testClaudeCodeLogin.mockResolvedValue({ ok: true, latencyMs: 1 })
})

describe('the default login check', () => {
  it('asks the binary this model runs, with its config dir, path and env', async () => {
    const env = { PATH: '/bin', CLAUDE_CONFIG_DIR: '/inherited' }
    const fq = fakeQuery([msg.start(), msg.success()])
    await createClaudeCodeModel({
      modelId: 'sonnet',
      query: fq.query,
      configDir: '/data/claude',
      pathToClaudeCodeExecutable: '/opt/claude',
      env,
    }).doGenerate(prompt)
    expect(testClaudeCodeLogin).toHaveBeenCalledTimes(1)
    expect(testClaudeCodeLogin).toHaveBeenCalledWith({
      configDir: '/data/claude',
      pathToClaudeCodeExecutable: '/opt/claude',
      env,
    })
    expect(fq.calls).toHaveLength(1)
  })

  it('leaves env out when none was given, so the check reads the process env itself', async () => {
    const fq = fakeQuery([msg.start(), msg.success()])
    await createClaudeCodeModel({ modelId: 'sonnet', query: fq.query }).doGenerate(prompt)
    expect(testClaudeCodeLogin).toHaveBeenCalledWith({
      configDir: undefined,
      pathToClaudeCodeExecutable: undefined,
    })
  })
})
