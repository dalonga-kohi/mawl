import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import type { RunId } from '@mawl/contracts'
import { migrationsFolder, schema } from '@mawl/db'
import { fakeModel } from '@mawl/testkit'
import { and, asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox, type SecretBox } from '../secrets/index.ts'
import { createServerTools } from '../tools/registry.ts'
import { RunRegistry } from './registry.ts'
import { createRunService } from './service.ts'
import { createRunStore } from './store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'
import { createRunTask } from './worker.ts'

const { runs, events, artifacts } = schema

describe('run.execute with the built-in tools (PGlite)', () => {
  const client = new PGlite({ extensions: { vector } })
  const db = drizzle(client, { schema })
  const logger = createLogger({ level: 'silent' })

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  }, 120_000)
  afterAll(() => client.close())

  // The fetch tests use example.com, which the profile allows (the policy engine asks otherwise).
  async function seedQueued(
    policy: Record<string, unknown> = { allowedHosts: ['example.com'] },
  ): Promise<RunId> {
    const profileId = await seedProfile(db, { policy })
    const threadId = await seedThread(db, profileId)
    const runId = await seedRun(db, profileId, { threadId })
    await seedMessage(db, threadId, 'user', [{ type: 'text', text: 'go' }], undefined, runId)
    return runId
  }

  const noSearch = {
    provider: async () => ({
      name: 'unused',
      search: () => Promise.reject(new Error('search is not used here')),
    }),
  }

  function task(
    model: ReturnType<typeof fakeModel>,
    over: { supportsTools?: boolean; secretBox?: SecretBox } = {},
  ) {
    const registry = new RunRegistry()
    const webFetch = vi.fn(
      async () =>
        new Response(`<p>${'long page text '.repeat(2000)}</p>`, {
          headers: { 'content-type': 'text/html' },
        }),
    )
    const run = createRunTask({
      db,
      registry,
      logger,
      resolveModel: async () => ({
        model,
        ...(over.supportsTools === undefined ? {} : { supportsTools: over.supportsTools }),
      }),
      requeue: async () => {},
      ...(over.secretBox ? { secretBox: over.secretBox } : {}),
      tools: createServerTools({ db, search: noSearch, webFetch }),
    })
    return {
      run: (runId: RunId) => run({ runId }, { abortSignal: new AbortController().signal }),
      registry,
      webFetch,
    }
  }

  const statusOf = async (id: RunId) =>
    (await db.select().from(runs).where(eq(runs.id, id)))[0]?.status
  const eventTypes = async (id: RunId) =>
    (await db.select().from(events).where(eq(events.runId, id)).orderBy(asc(events.id))).map(
      (e) => e.type,
    )

  it('offers the built-in tools to a model that supports them, and none otherwise', async () => {
    const withTools = fakeModel([{ text: 'hi' }])
    await task(withTools).run(await seedQueued())
    expect((withTools.calls[0]?.tools ?? []).map((t) => t.name).sort()).toEqual([
      'ask_user',
      'notify',
      'read_artifact',
      'web_fetch',
      'web_search',
    ])
    const without = fakeModel([{ text: 'hi' }])
    await task(without, { supportsTools: false }).run(await seedQueued())
    expect(without.calls[0]?.tools ?? []).toHaveLength(0)
  })

  it('parks on ask_user, releases the job, and resumes with the reply as the result', async () => {
    const runId = await seedQueued()
    const first = task(
      fakeModel([{ toolCalls: [{ name: 'ask_user', input: { question: 'Blue or green?' } }] }]),
    )
    await first.run(runId)
    expect(await statusOf(runId)).toBe('waiting_user')
    expect(first.registry.size).toBe(0)

    const enqueued: RunId[] = []
    const service = createRunService({
      db,
      registry: new RunRegistry(),
      logger,
      enqueue: async (id) => void enqueued.push(id),
    })
    await service.reply(runId, 'Green')
    expect(enqueued).toEqual([runId])

    const model = fakeModel([{ text: 'Green it is' }])
    await task(model).run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
    const prompt = model.calls[0]?.prompt ?? []
    const toolMsg = prompt.find((m) => m.role === 'tool')
    expect(JSON.stringify(toolMsg)).toContain('<tool_result>\\nGreen\\n</tool_result>')
    expect(await eventTypes(runId)).toEqual(
      expect.arrayContaining(['run.tool_call', 'run.tool_result']),
    )
  })

  it('stores a large web page as an artifact and hands the model a preview', async () => {
    const runId = await seedQueued()
    const t = task(
      fakeModel([
        { toolCalls: [{ name: 'web_fetch', input: { url: 'https://example.com/' } }] },
        { text: 'read it' },
      ]),
    )
    await t.run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
    const [art] = await db.select().from(artifacts).where(eq(artifacts.runId, runId))
    expect(art?.tokenCount).toBeGreaterThan(4000)
    const result = await createRunStore(db).toolResult(runId, { stepIdx: 0, toolCallId: 'call_1' })
    expect(result?.artifactId).toBe(art?.id)
  })

  it('goes through the policy engine by default: a first fetch to a host waits for approval', async () => {
    const runId = await seedQueued({})
    const t = task(
      fakeModel([{ toolCalls: [{ name: 'web_fetch', input: { url: 'https://example.com/' } }] }]),
      { secretBox: await createSecretBox(new Uint8Array(randomBytes(32))) },
    )
    await t.run(runId)
    expect(await statusOf(runId)).toBe('waiting_approval')
    expect(t.registry.size).toBe(0)
    expect(t.webFetch).not.toHaveBeenCalled()
    const result = await createRunStore(db).toolResult(runId, { stepIdx: 0, toolCallId: 'call_1' })
    expect(result).toBeNull()
    const [call] = await db
      .select()
      .from(events)
      .where(and(eq(events.runId, runId), eq(events.type, 'run.tool_call')))
    expect(call?.payload).toMatchObject({ tool: 'web_fetch', level: 'ask', source: 'global' })
  })

  it('notifies once even when the run resumes after the tools ran', async () => {
    const runId = await seedQueued()
    const store = createRunStore(db)
    // What a crash leaves behind: the model step and notify's recorded result (with its event),
    // but no tool row yet.
    await db.update(runs).set({ status: 'running' }).where(eq(runs.id, runId))
    await store.appendStep(
      runId,
      {
        idx: 0,
        assistantMessages: [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 'n1',
                toolName: 'notify',
                input: { title: 'Done', body: 'b' },
              },
            ],
          },
        ],
        usage: { inputTokens: 1, outputTokens: 1 },
        activeMsDelta: 0,
      },
      { inputTokens: 1, outputTokens: 1 },
    )
    await store.recordToolResult(
      runId,
      { stepIdx: 0, toolCallId: 'n1' },
      {
        toolName: 'notify',
        output: { type: 'text', value: 'sent' },
        isError: false,
        preview: 'sent',
        artifactId: null,
      },
      [{ type: 'notify', payload: { title: 'Done', body: 'b', level: 'info' } }],
    )
    // Resume: the recorded call is not run again, so no second notify event.
    await task(fakeModel([{ text: 'all done' }])).run(runId)
    expect(await statusOf(runId)).toBe('succeeded')
    expect((await eventTypes(runId)).filter((t) => t === 'notify')).toHaveLength(1)
  })
})
