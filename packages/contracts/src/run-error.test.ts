import { describe, expect, it } from 'vitest'
import { Run, RunBudget } from './entities'
import { ProviderFailureReason, RunErrorCode } from './enums'
import { EVENT_PAYLOADS } from './events'
import { run } from './fixtures'

describe('RunErrorCode', () => {
  it('covers every provider failure reason', () => {
    for (const reason of ProviderFailureReason.options) {
      expect(RunErrorCode.safeParse(reason).success).toBe(true)
    }
  })

  it('adds the engine-only codes', () => {
    for (const code of [
      'model_not_configured',
      'budget_steps',
      'budget_tokens',
      'budget_wall_clock',
      'internal_error',
    ]) {
      expect(RunErrorCode.safeParse(code).success).toBe(true)
    }
  })

  it('rejects free text', () => {
    expect(RunErrorCode.safeParse('Error: ECONNREFUSED 10.0.0.1').success).toBe(false)
  })
})

describe('Run.error', () => {
  it('accepts null and a code, rejects free text', () => {
    expect(Run.safeParse({ ...run, error: null }).success).toBe(true)
    expect(Run.safeParse({ ...run, status: 'failed', error: 'budget_steps' }).success).toBe(true)
    expect(Run.safeParse({ ...run, status: 'failed', error: 'it broke' }).success).toBe(false)
  })
})

describe('run.status event', () => {
  it('carries a run error code, not free text', () => {
    const schema = EVENT_PAYLOADS['run.status']
    expect(schema.safeParse({ status: 'failed', error: 'plan_limit_reached' }).success).toBe(true)
    expect(schema.safeParse({ status: 'failed', error: 'stack trace' }).success).toBe(false)
  })
})

describe('RunBudget', () => {
  it('stays unchanged: cost cap is accepted but not enforced yet', () => {
    expect(RunBudget.safeParse({ maxCostUsd: 1 }).success).toBe(true)
  })
})
