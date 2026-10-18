import { schema } from '@faire/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { insertEvent, recordEvent } from '../runs/repo.ts'
import { seedProfile } from '../runs/test-util.ts'
import { EVENTS_CHANNEL } from './source.ts'
import { pgliteDb } from './test-util.ts'

describe('events repo helper notifies listeners', () => {
  const open: { close(): Promise<void> }[] = []
  afterEach(async () => {
    for (const o of open.splice(0)) await o.close()
  })

  it('sends one tiny notification per event, carrying the event id, after commit', async () => {
    const env = await pgliteDb()
    open.push(env)
    const profileId = await seedProfile(env.db)
    const payloads: string[] = []
    await env.client.listen(EVENTS_CHANNEL, (p) => payloads.push(p))

    const id = await insertEvent(env.db, { profileId, runId: null, type: 'notify', payload: null })
    await vi.waitFor(() => expect(payloads).toEqual([JSON.stringify({ id })]))
    expect(typeof id).toBe('number')
  })

  it('does not notify when the surrounding transaction rolls back', async () => {
    const env = await pgliteDb()
    open.push(env)
    const profileId = await seedProfile(env.db)
    const payloads: string[] = []
    await env.client.listen(EVENTS_CHANNEL, (p) => payloads.push(p))

    await expect(
      env.db.transaction(async (tx) => {
        await recordEvent(tx, {
          profileId,
          runId: null,
          type: 'notify',
          payload: { title: 't', body: 'b', level: 'info' },
        })
        throw new Error('rollback')
      }),
    ).rejects.toThrow('rollback')
    await env.client.query('select 1')
    expect(payloads).toEqual([])
    const rows = await env.db.select().from(schema.events)
    expect(rows).toHaveLength(0)
  })
})
