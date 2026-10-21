import { ProviderFailureReason } from '@mawl/contracts'
import { describe, expect, it } from 'vitest'
import { ProviderFailureError } from '../providers/failure.ts'
import { ModelNotConfiguredError, toRunErrorCode } from './errors.ts'
import { addUsage, finalText } from './execute.ts'

describe('toRunErrorCode', () => {
  it.each(ProviderFailureReason.options)('maps the provider reason %s to itself', (reason) => {
    expect(toRunErrorCode(new ProviderFailureError(reason))).toBe(reason)
  })

  it('maps a missing model to model_not_configured', () => {
    expect(toRunErrorCode(new ModelNotConfiguredError())).toBe('model_not_configured')
  })

  it.each([new Error('x'), 'text', null, undefined, { reason: 'plan_limit_reached' }])(
    'maps anything else to internal_error',
    (err) => {
      expect(toRunErrorCode(err)).toBe('internal_error')
    },
  )
})

describe('addUsage', () => {
  it('sums tokens and keeps cached tokens only when one side has them', () => {
    expect(
      addUsage({ inputTokens: 1, outputTokens: 2 }, { inputTokens: 3, outputTokens: 4 }),
    ).toEqual({ inputTokens: 4, outputTokens: 6 })
    expect(
      addUsage(
        { inputTokens: 1, outputTokens: 2, cachedTokens: 1 },
        { inputTokens: 3, outputTokens: 4 },
      ),
    ).toEqual({ inputTokens: 4, outputTokens: 6, cachedTokens: 1 })
  })
})

describe('finalText', () => {
  it('joins the text of model steps with a blank line and skips tool and silent steps', () => {
    const text = finalText([
      { idx: 0, kind: 'model', messages: [{ role: 'assistant', content: 'one' }], usage: null },
      { idx: 1, kind: 'tool', messages: [], usage: null },
      {
        idx: 2,
        kind: 'model',
        messages: [
          {
            role: 'assistant',
            content: [{ type: 'tool-call', toolCallId: 'c', toolName: 't', input: {} }],
          },
        ],
        usage: null,
      },
      {
        idx: 3,
        kind: 'model',
        messages: [{ role: 'assistant', content: [{ type: 'text', text: 'two' }] }],
        usage: null,
      },
    ])
    expect(text).toBe('one\n\ntwo')
  })
})
