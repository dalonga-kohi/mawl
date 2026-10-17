import { newId } from '@faire/contracts'
import { and, eq, gt, type SQL, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import type * as schemaNs from './schema.ts'
import {
  artifacts,
  events,
  messages,
  profiles,
  providerCredentials,
  runSteps,
  runs,
  threads,
} from './schema.ts'

export type TestDb = PgDatabase<PgQueryResultHKT, typeof schemaNs>

export interface MadeDb {
  db: TestDb
  /** Applies the committed migrations through the driver's migrator. */
  migrate(): Promise<void>
  close(): Promise<void>
}

/** Runs raw SQL; node-postgres and PGlite both return { rows }. */
async function rowsOf<T>(db: TestDb, q: SQL): Promise<T[]> {
  return ((await db.execute(q)) as { rows: T[] }).rows
}

/** Postgres SQLSTATE of an error, looking through drizzle's DrizzleQueryError wrapper. */
function pgCode(err: unknown): string | undefined {
  let e: unknown = err
  for (let i = 0; i < 3 && e; i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string') return code
    e = (e as { cause?: unknown }).cause
  }
  return undefined
}

async function expectPgError(p: Promise<unknown>, code: string) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e ?? new Error('rejected with nothing'),
  )
  expect(err, 'expected the statement to fail').toBeDefined()
  expect(pgCode(err)).toBe(code)
}

const UNIQUE = '23505'
const CHECK = '23514'
const FK = '23503'
const INVALID_TEXT = '22P02'

/**
 * The migration integration suite. Runs against whatever Postgres `make` returns (PGlite in
 * process, or a real container) so both prove the same behavior. Call inside the test file's
 * top level; `make` is invoked once per test for an isolated, empty database.
 */
export function describeMigrations(label: string, make: () => Promise<MadeDb>) {
  async function fresh() {
    const m = await make()
    await m.migrate()
    return m
  }

  async function seedProfile(db: TestDb) {
    const id = newId('profile')
    await db.insert(profiles).values({
      id,
      name: 'Ada',
      slug: `ada-${id}`.toLowerCase(),
      color: '#112233',
      modelMain: 'm',
    })
    return id
  }

  async function seedRun(db: TestDb, threadId?: ReturnType<typeof newId<'thread'>>) {
    const profileId = await seedProfile(db)
    const id = newId('run')
    await db
      .insert(runs)
      .values({ id, profileId, trigger: 'user', ...(threadId ? { threadId } : {}) })
    return { id, profileId }
  }

  describe(label, () => {
    it('migrates an empty database and is idempotent', async () => {
      const m = await make()
      try {
        await m.migrate()
        await m.migrate()
        const [row] = await rowsOf<{ n: number }>(
          m.db,
          sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
        )
        // 8 tables (the drizzle journal lives in schema "drizzle").
        expect(row?.n).toBe(8)
      } finally {
        await m.close()
      }
    })

    it('has pgvector and full-text search available', async () => {
      const m = await fresh()
      try {
        const [v] = await rowsOf<{ v: string }>(m.db, sql`select '[1,2,3]'::vector(3)::text as v`)
        expect(v?.v).toBe('[1,2,3]')
        const [t] = await rowsOf<{ t: string }>(
          m.db,
          sql`select to_tsvector('simple', 'x')::text as t`,
        )
        expect(t?.t).toBe("'x':1")
      } finally {
        await m.close()
      }
    })

    it('rejects a duplicate (run_id, idx) step', async () => {
      const m = await fresh()
      try {
        const { id: runId } = await seedRun(m.db)
        const step = (idx: number) => ({
          id: newId('step'),
          runId,
          idx,
          kind: 'model' as const,
          input: { a: 1 },
        })
        await m.db.insert(runSteps).values(step(0))
        await expectPgError(m.db.insert(runSteps).values(step(0)), UNIQUE)
        await m.db.insert(runSteps).values(step(1))
        await expectPgError(m.db.insert(runSteps).values(step(-1)), CHECK)
      } finally {
        await m.close()
      }
    })

    it('enforces artifact content xor path and non-negative counts', async () => {
      const m = await fresh()
      try {
        const { profileId } = await seedRun(m.db)
        const base = () => ({
          id: newId('artifact'),
          profileId,
          mime: 'text/plain',
          sizeBytes: 3,
          preview: 'abc',
          tokenCount: 1,
        })
        await m.db.insert(artifacts).values({ ...base(), content: new Uint8Array([1, 2, 3]) })
        await m.db.insert(artifacts).values({ ...base(), path: '/data/a.txt' })
        await expectPgError(
          m.db
            .insert(artifacts)
            .values({ ...base(), content: new Uint8Array([1]), path: '/data/a.txt' }),
          CHECK,
        )
        await expectPgError(m.db.insert(artifacts).values(base()), CHECK)
        await expectPgError(
          m.db.insert(artifacts).values({ ...base(), path: '/x', tokenCount: -1 }),
          CHECK,
        )
      } finally {
        await m.close()
      }
    })

    it('rejects a thread channel outside app + channel kinds', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        const row = (channel: string) =>
          ({ id: newId('thread'), profileId, channel }) as typeof threads.$inferInsert
        await m.db.insert(threads).values(row('app'))
        await m.db.insert(threads).values(row('telegram'))
        await expectPgError(m.db.insert(threads).values(row('sms')), CHECK)
      } finally {
        await m.close()
      }
    })

    it('cascades thread -> messages and nulls message.run_id when a run is deleted', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        const threadId = newId('thread')
        await m.db.insert(threads).values({ id: threadId, profileId, channel: 'app' })
        const runId = newId('run')
        await m.db.insert(runs).values({ id: runId, profileId, threadId, trigger: 'user' })
        const msgId = newId('message')
        await m.db.insert(messages).values({
          id: msgId,
          threadId,
          runId,
          role: 'user',
          parts: [{ type: 'text', text: 'hi' }],
        })
        await m.db
          .insert(runSteps)
          .values({ id: newId('step'), runId, idx: 0, kind: 'tool', input: {} })
        const artId = newId('artifact')
        await m.db.insert(artifacts).values({
          id: artId,
          profileId,
          runId,
          mime: 'text/plain',
          sizeBytes: 0,
          preview: '',
          tokenCount: 0,
          path: '/p',
        })

        await m.db.delete(runs).where(eq(runs.id, runId))
        const [msg] = await m.db.select().from(messages).where(eq(messages.id, msgId))
        expect(msg?.runId).toBeNull()
        expect(await m.db.select().from(runSteps)).toHaveLength(0)
        const [art] = await m.db.select().from(artifacts).where(eq(artifacts.id, artId))
        expect(art?.runId).toBeNull()

        await m.db.delete(threads).where(eq(threads.id, threadId))
        expect(await m.db.select().from(messages)).toHaveLength(0)
      } finally {
        await m.close()
      }
    })

    it('events.id increases monotonically and run delete nulls events.run_id', async () => {
      const m = await fresh()
      try {
        const { id: runId, profileId } = await seedRun(m.db)
        const ids: number[] = []
        for (const type of ['a', 'b', 'c']) {
          const [row] = await m.db
            .insert(events)
            .values({ profileId, runId, type, payload: { type } })
            .returning({ id: events.id })
          ids.push(row?.id as number)
        }
        expect(ids.every((id) => typeof id === 'number')).toBe(true)
        expect(ids).toEqual([...ids].sort((x, y) => x - y))
        expect(new Set(ids).size).toBe(3)
        await m.db.delete(runs).where(eq(runs.id, runId))
        const rows = await m.db.select().from(events)
        expect(rows.every((r) => r.runId === null)).toBe(true)
      } finally {
        await m.close()
      }
    })

    it('round-trips provider secret bytes exactly', async () => {
      const m = await fresh()
      try {
        const all = Uint8Array.from({ length: 256 }, (_, i) => i)
        const id = newId('credential')
        await m.db
          .insert(providerCredentials)
          .values({ id, provider: 'anthropic', label: 'main', secretEnc: all })
        const [row] = await m.db
          .select()
          .from(providerCredentials)
          .where(eq(providerCredentials.id, id))
        expect(Array.from(row?.secretEnc ?? [])).toEqual(Array.from(all))
        expect(row?.baseUrl).toBeNull()
      } finally {
        await m.close()
      }
    })

    it('round-trips jsonb columns and applies run defaults', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        const threadId = newId('thread')
        await m.db.insert(threads).values({ id: threadId, profileId, channel: 'app' })
        const runId = newId('run')
        await m.db.insert(runs).values({ id: runId, profileId, trigger: 'routine' })
        const [run] = await m.db.select().from(runs).where(eq(runs.id, runId))
        expect(run).toMatchObject({
          status: 'queued',
          budget: {},
          usage: { inputTokens: 0, outputTokens: 0 },
          segmentNo: 0,
          threadId: null,
        })
        const parts = [
          { type: 'text' as const, text: 'hello' },
          { type: 'tool_call' as const, toolCallId: 'c1', tool: 't', args: { n: [1, null] } },
        ]
        const id = newId('message')
        await m.db.insert(messages).values({ id, threadId, role: 'assistant', parts })
        const [msg] = await m.db.select().from(messages).where(eq(messages.id, id))
        expect(msg?.parts).toEqual(parts)
      } finally {
        await m.close()
      }
    })

    it('round-trips unicode and large jsonb parts', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        const threadId = newId('thread')
        await m.db.insert(threads).values({ id: threadId, profileId, channel: 'app' })
        const text = `日本語 ünï 🎉 \\u0041 "q" \n\t${'x'.repeat(200_000)}`
        const parts = [{ type: 'text' as const, text }]
        const id = newId('message')
        await m.db.insert(messages).values({ id, threadId, role: 'user', parts })
        const [msg] = await m.db.select().from(messages).where(eq(messages.id, id))
        expect(msg?.parts).toEqual(parts)
      } finally {
        await m.close()
      }
    })

    it('rejects negative message token_count and accepts null and zero', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        const threadId = newId('thread')
        await m.db.insert(threads).values({ id: threadId, profileId, channel: 'app' })
        const row = (tokenCount?: number | null) => ({
          id: newId('message'),
          threadId,
          role: 'user' as const,
          parts: [],
          ...(tokenCount === undefined ? {} : { tokenCount }),
        })
        await m.db.insert(messages).values(row())
        await m.db.insert(messages).values(row(null))
        await m.db.insert(messages).values(row(0))
        await expectPgError(m.db.insert(messages).values(row(-1)), CHECK)
      } finally {
        await m.close()
      }
    })

    it('rejects a negative runs.segment_no', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        await expectPgError(
          m.db.insert(runs).values({ id: newId('run'), profileId, trigger: 'user', segmentNo: -1 }),
          CHECK,
        )
      } finally {
        await m.close()
      }
    })

    it('rejects a negative artifact size_bytes', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        await expectPgError(
          m.db.insert(artifacts).values({
            id: newId('artifact'),
            profileId,
            mime: 'text/plain',
            sizeBytes: -1,
            preview: '',
            tokenCount: 0,
            path: '/p',
          }),
          CHECK,
        )
      } finally {
        await m.close()
      }
    })

    it('enforces unique profile slugs', async () => {
      const m = await fresh()
      try {
        const profile = (slug: string) => ({
          id: newId('profile'),
          name: 'A',
          slug,
          color: '#000000',
          modelMain: 'm',
        })
        await m.db.insert(profiles).values(profile('ada'))
        await expectPgError(m.db.insert(profiles).values(profile('ada')), UNIQUE)
        await m.db.insert(profiles).values(profile('bob'))
      } finally {
        await m.close()
      }
    })

    it('rejects an invalid enum value', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        await expectPgError(
          m.db.insert(runs).values({
            id: newId('run'),
            profileId,
            trigger: 'bogus' as unknown as 'user',
          }),
          INVALID_TEXT,
        )
        await expectPgError(
          m.db.insert(runs).values({
            id: newId('run'),
            profileId,
            trigger: 'user',
            status: 'bogus' as unknown as 'queued',
          }),
          INVALID_TEXT,
        )
      } finally {
        await m.close()
      }
    })

    it('rejects a message whose thread does not exist', async () => {
      const m = await fresh()
      try {
        await expectPgError(
          m.db.insert(messages).values({
            id: newId('message'),
            threadId: newId('thread'),
            role: 'user',
            parts: [],
          }),
          FK,
        )
      } finally {
        await m.close()
      }
    })

    it('rejects a run, artifact or event pointing at an unknown parent', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        await expectPgError(
          m.db.insert(runs).values({
            id: newId('run'),
            profileId,
            threadId: newId('thread'),
            trigger: 'user',
          }),
          FK,
        )
        await expectPgError(
          m.db.insert(runSteps).values({
            id: newId('step'),
            runId: newId('run'),
            idx: 0,
            kind: 'model',
            input: {},
          }),
          FK,
        )
        await expectPgError(
          m.db.insert(events).values({ profileId, runId: newId('run'), type: 't', payload: {} }),
          FK,
        )
      } finally {
        await m.close()
      }
    })

    it('blocks deleting a profile that still has threads, runs or artifacts', async () => {
      const m = await fresh()
      try {
        const profileId = await seedProfile(m.db)
        await m.db.insert(threads).values({ id: newId('thread'), profileId, channel: 'app' })
        await expectPgError(m.db.delete(profiles).where(eq(profiles.id, profileId)), FK)
        expect(await m.db.select().from(threads)).toHaveLength(1)

        const other = await seedRun(m.db)
        await expectPgError(m.db.delete(profiles).where(eq(profiles.id, other.profileId)), FK)

        const lone = await seedProfile(m.db)
        await m.db.delete(profiles).where(eq(profiles.id, lone))
      } finally {
        await m.close()
      }
    })

    it('orders events by id within a profile, interleaved with another profile', async () => {
      const m = await fresh()
      try {
        const a = await seedProfile(m.db)
        const b = await seedProfile(m.db)
        for (let i = 0; i < 6; i++) {
          await m.db
            .insert(events)
            .values({ profileId: i % 2 ? a : b, type: `t${i}`, payload: { i } })
        }
        const rows = await m.db
          .select()
          .from(events)
          .where(eq(events.profileId, a))
          .orderBy(events.id)
        expect(rows.map((r) => r.type)).toEqual(['t1', 't3', 't5'])
        const ids = rows.map((r) => r.id)
        expect(ids).toEqual([...ids].sort((x, y) => x - y))
        const since = rows[0]?.id as number
        const after = await m.db
          .select()
          .from(events)
          .where(and(eq(events.profileId, a), gt(events.id, since)))
          .orderBy(events.id)
        expect(after.map((r) => r.type)).toEqual(['t3', 't5'])
      } finally {
        await m.close()
      }
    })

    it('stores timestamps as timestamptz and round-trips UTC instants', async () => {
      const m = await fresh()
      try {
        const cols = await rowsOf<{ table_name: string; column_name: string; data_type: string }>(
          m.db,
          sql`select table_name, column_name, data_type from information_schema.columns
              where table_schema = 'public' and column_name in
              ('created_at','archived_at','last_event_at','started_at','ended_at')`,
        )
        expect(cols.length).toBeGreaterThanOrEqual(10)
        for (const c of cols) {
          expect(c.data_type, `${c.table_name}.${c.column_name}`).toBe('timestamp with time zone')
        }

        const profileId = await seedProfile(m.db)
        const instant = new Date('2026-03-29T00:30:00.123Z')
        const threadId = newId('thread')
        await m.db.insert(threads).values({
          id: threadId,
          profileId,
          channel: 'app',
          createdAt: instant,
          lastEventAt: instant,
        })
        const [row] = await m.db.select().from(threads).where(eq(threads.id, threadId))
        expect(row?.createdAt.toISOString()).toBe('2026-03-29T00:30:00.123Z')
        expect(row?.lastEventAt?.toISOString()).toBe('2026-03-29T00:30:00.123Z')
      } finally {
        await m.close()
      }
    })
  })
}
