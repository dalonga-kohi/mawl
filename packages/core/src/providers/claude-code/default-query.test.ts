import { describe, expect, it } from 'vitest'
import { defaultClaudeQuery } from './default-query.ts'

describe('defaultClaudeQuery', () => {
  it('does not start the binary when closed before the first read', async () => {
    const handle = defaultClaudeQuery({ prompt: 'hi', options: {} })
    handle.close?.()
    const seen: unknown[] = []
    for await (const m of handle) seen.push(m)
    expect(seen).toEqual([])
  })

  it('targets the SDK export that exists in the installed version', async () => {
    // Importing the SDK spawns nothing; this guards the lazy import and the `query` name.
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    expect(sdk.query).toBeTypeOf('function')
  })
})
