import { describe, expect, it } from 'vitest'
import { ConfigError } from './config.ts'
import { describeFailure } from './failure.ts'
import { MasterKeyError, SecretDecryptError } from './secrets/index.ts'

describe('describeFailure', () => {
  it('logs only the name and code for foreign errors, never the message', () => {
    const err = Object.assign(new Error('connect failed for postgres://u:LEAK-ME@h/d'), {
      code: 'ECONNREFUSED',
      connectionString: 'postgres://u:LEAK-ME@h/d',
    })
    const out = describeFailure(err)
    expect(out).toEqual({ errName: 'Error', code: 'ECONNREFUSED' })
    expect(JSON.stringify(out)).not.toContain('LEAK-ME')
  })

  it('drops codes that are not short upper-case identifiers', () => {
    const err = Object.assign(new Error('x'), { code: 'postgres://u:LEAK-ME@h/d' })
    expect(describeFailure(err)).toEqual({ errName: 'Error' })
  })

  it('includes the reason for our own error classes', () => {
    expect(
      describeFailure(new ConfigError([{ name: 'MAWL_PORT', message: 'must be 1-65535' }])),
    ).toMatchObject({
      errName: 'ConfigError',
      reason: expect.stringContaining('MAWL_PORT'),
    })
    expect(describeFailure(new MasterKeyError('bad key file'))).toMatchObject({
      errName: 'MasterKeyError',
      reason: 'bad key file',
    })
    expect(describeFailure(new SecretDecryptError())).toMatchObject({
      reason: 'Failed to decrypt secret',
    })
  })

  it('handles non-Error throwables', () => {
    expect(describeFailure('postgres://u:LEAK-ME@h/d')).toEqual({ errName: 'UnknownError' })
    expect(describeFailure(undefined)).toEqual({ errName: 'UnknownError' })
  })
})
