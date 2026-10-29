import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { newId, type ProfileId, type RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createRunStore } from '../runs/store.ts'
import { seedProfile, seedRun } from '../runs/test-util.ts'
import { createPolicyGate } from './policy.ts'

const { profiles } = schema

describe('the server policy gate (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const logger = createLogger({ level: 'silent' })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  }, 120_000)
  afterAll(() => client.close())

  const fetchReq = (runId: RunId, profileId: ProfileId, url: string) => ({
    runId,
    profileId,
    tool: 'web_fetch',
    actionClass: 'read' as const,
    args: { url },
    argsRedacted: { url },
  })

  async function seed(policy: Record<string, unknown> = {}, trigger: 'user' | 'teammate' = 'user') {
    const profileId = await seedProfile(db)
    await db.update(profiles).set({ policy }).where(eq(profiles.id, profileId))
    const runId = await seedRun(db, profileId, { trigger })
    return { profileId, runId }
  }

  it('reads the profile policy: an allow-listed host is allowed', async () => {
    const { profileId, runId } = await seed({ allowedHosts: ['example.com'] })
    const d = await createPolicyGate(db, logger).check(
      fetchReq(runId, profileId, 'https://example.com/'),
    )
    expect(d).toMatchObject({ decision: 'allow', audit: { level: 'auto', source: 'user_rule' } })
  })

  it('parks a first fetch to an unknown host for approval', async () => {
    const { profileId, runId } = await seed()
    const d = await createPolicyGate(db, logger).check(
      fetchReq(runId, profileId, 'https://example.org/'),
    )
    expect(d).toMatchObject({ decision: 'park', audit: { level: 'ask', source: 'global' } })
  })

  it('a host fetched earlier in the run is allowed by a fresh gate (survives a resume)', async () => {
    const { profileId, runId } = await seed()
    const store = createRunStore(db)
    await store.recordToolCall(runId, {
      toolCallId: 'c1',
      tool: 'web_fetch',
      argsRedacted: { url: 'https://example.org:443/a?…' },
      actionClass: 'read',
      level: 'auto',
      source: 'autopilot',
      mode: 'autopilot',
    })
    // A denied call to another host must not unlock it.
    await store.recordToolCall(runId, {
      toolCallId: 'c2',
      tool: 'web_fetch',
      argsRedacted: { url: 'https://denied.example/' },
      actionClass: 'read',
      level: 'ask',
      source: 'global',
    })
    const gate = createPolicyGate(db, logger)
    expect(await gate.check(fetchReq(runId, profileId, 'https://EXAMPLE.org/b'))).toMatchObject({
      decision: 'allow',
    })
    expect(await gate.check(fetchReq(runId, profileId, 'https://denied.example/'))).toMatchObject({
      decision: 'park',
    })
  })

  it('a host the owner approved earlier in the run counts as seen', async () => {
    const { profileId, runId } = await seed()
    const store = createRunStore(db)
    await store.recordToolCall(runId, {
      toolCallId: 'c1',
      tool: 'web_fetch',
      argsRedacted: { url: 'https://approved.example/a' },
      actionClass: 'read',
      level: 'ask',
      source: 'global',
      approved: true,
    })
    const gate = createPolicyGate(db, logger)
    expect(
      await gate.check(fetchReq(runId, profileId, 'https://approved.example/b')),
    ).toMatchObject({ decision: 'allow', audit: { level: 'auto' } })
    // A redirect hop to it is followed too; one to an unseen host is not.
    const hop = (to: string) =>
      gate.checkRedirect?.({
        runId,
        profileId,
        tool: 'web_fetch',
        actionClass: 'read',
        from: 'https://other.example/',
        to,
      })
    expect(await hop('https://approved.example/c')).toBe(true)
    expect(await hop('https://unseen.example/')).toBe(false)
  })

  it('hosts seen in another run do not count', async () => {
    const { profileId, runId } = await seed()
    const other = await seedRun(db, profileId)
    await createRunStore(db).recordToolCall(other, {
      toolCallId: 'c1',
      tool: 'web_fetch',
      argsRedacted: { url: 'https://example.net/' },
      actionClass: 'read',
      level: 'auto',
      source: 'global',
    })
    expect(
      await createPolicyGate(db, logger).check(fetchReq(runId, profileId, 'https://example.net/')),
    ).toMatchObject({ decision: 'park' })
  })

  it('stores the audit fields on run.tool_call', async () => {
    const { runId } = await seed()
    await createRunStore(db).recordToolCall(runId, {
      toolCallId: 'c9',
      tool: 'web_fetch',
      argsRedacted: {},
      actionClass: 'read',
      level: 'block',
      source: 'floor',
    })
    const rows = await db.select().from(schema.events).where(eq(schema.events.runId, runId))
    expect(rows[0]?.payload).toMatchObject({ level: 'block', source: 'floor' })
  })

  it('an invalid policy_json falls back to the defaults and logs a warning without the value', async () => {
    const warn = vi.spyOn(logger, 'warn')
    const { profileId, runId } = await seed({ mode: 'autopilot', allowAll: true })
    const d = await createPolicyGate(db, logger).check(
      fetchReq(runId, profileId, 'https://example.com/'),
    )
    expect(d).toMatchObject({ decision: 'park', audit: { level: 'ask' } })
    expect(warn).toHaveBeenCalledWith({ profileId }, expect.stringContaining('policy'))
    warn.mockRestore()
  })

  it('a teammate-triggered run is read from the run row', async () => {
    const { profileId, runId } = await seed({ mode: 'autopilot' }, 'teammate')
    const d = await createPolicyGate(db, logger).check({
      runId,
      profileId,
      tool: 'notify_later',
      actionClass: 'write_local',
      args: {},
      argsRedacted: {},
    })
    expect(d).toMatchObject({ decision: 'park', audit: { level: 'ask', source: 'global' } })
  })

  it('an unknown run fails closed', async () => {
    const d = await createPolicyGate(db, logger).check({
      runId: newId('run'),
      profileId: newId('profile'),
      tool: 'w',
      actionClass: 'write_local',
      args: {},
      argsRedacted: {},
    })
    // The strict fallback (teammate trigger): never allowed without the owner.
    expect(d).toMatchObject({ decision: 'park', audit: { level: 'ask' } })
  })
})
