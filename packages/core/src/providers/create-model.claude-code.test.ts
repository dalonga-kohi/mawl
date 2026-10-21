import { describe, expect, it } from 'vitest'
import { fakeQuery, msg } from './claude-code/test-util.ts'
import { createLanguageModel } from './create-model.ts'

const conn = { kind: 'anthropic_claude_code', baseUrl: null, secret: null } as const
const okLogin = async () => ({ ok: true as const, latencyMs: 1 })
const prompt = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }]

describe('createLanguageModel for anthropic_claude_code', () => {
  it('builds the Claude Code adapter with the configured config dir and binary path', async () => {
    const fq = fakeQuery([msg.success()])
    const model = createLanguageModel(conn, 'sonnet', {
      claudeCode: {
        configDir: '/data/claude',
        pathToClaudeCodeExecutable: '/opt/claude',
        query: fq.query,
        checkLogin: okLogin,
      },
    })
    expect(model.provider).toBe('anthropic-claude-code')
    expect(model.modelId).toBe('sonnet')
    await model.doGenerate({ prompt })
    expect(fq.calls[0]?.options).toMatchObject({
      model: 'sonnet',
      pathToClaudeCodeExecutable: '/opt/claude',
      env: { CLAUDE_CONFIG_DIR: '/data/claude' },
    })
  })

  it('works with no options at all (default binary, default config location)', () => {
    expect(createLanguageModel(conn, 'sonnet').specificationVersion).toBe('v4')
  })

  it('ignores a stored secret or base url: the Claude login is never Mawl’s to hold', async () => {
    const fq = fakeQuery([msg.success()])
    const model = createLanguageModel(
      { kind: 'anthropic_claude_code', baseUrl: 'https://evil.example', secret: 'sk-ant-oat01-x' },
      'sonnet',
      { claudeCode: { query: fq.query, checkLogin: okLogin } },
    )
    await model.doGenerate({ prompt })
    expect(JSON.stringify(fq.calls[0])).not.toContain('sk-ant-oat01')
    expect(JSON.stringify(fq.calls[0])).not.toContain('evil.example')
  })
})
