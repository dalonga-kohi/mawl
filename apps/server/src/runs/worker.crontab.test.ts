import { parseCrontab } from 'graphile-worker'
import { describe, expect, it } from 'vitest'
import { APPROVALS_CRONTAB, APPROVALS_EXPIRE_TASK } from './worker.ts'

describe('the approvals expiry schedule', () => {
  it('is a valid Graphile crontab that runs the expiry task every minute', () => {
    const [item, ...rest] = parseCrontab(APPROVALS_CRONTAB)
    expect(rest).toEqual([])
    expect(item?.task).toBe(APPROVALS_EXPIRE_TASK)
    expect(item?.task).toBe('approvals_expire')
    expect(APPROVALS_CRONTAB.startsWith('* * * * * ')).toBe(true)
  })
})
