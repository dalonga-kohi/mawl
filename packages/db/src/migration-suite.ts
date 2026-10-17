import { newId } from '@faire/contracts'
import { eq, type SQL, sql } from 'drizzle-orm'
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
  })
}
