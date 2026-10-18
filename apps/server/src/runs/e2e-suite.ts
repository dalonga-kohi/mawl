import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { contract, RunId } from '@faire/contracts'
import type { ResolvedModel } from '@faire/core'
import { createDb, migrate, schema } from '@faire/db'
import { fakeModel, type Turn } from '@faire/testkit'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import { RPCLink as WsLink } from '@orpc/client/websocket'
import type { ContractRouterClient } from '@orpc/contract'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { createLogger } from '../logger.ts'
import { type RunningServer, startServer } from '../server.ts'
import { createRunStore } from './store.ts'
import { seedMessage, seedProfile, seedRun, seedThread } from './test-util.ts'

const { runs, messages } = schema

type Client = ContractRouterClient<typeof contract>

/** End to end: RPC, Graphile Worker, the engine and the Drizzle store together. */
export function describeRunEngineE2e(adminUrl: () => string): void {
  describe('run engine end to end (real Postgres, Graphile Worker)', () => {
    let dir: string
    const servers: RunningServer[] = []

    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'faire-run-e2e-'))
    })
    afterEach(async () => {
      for (const s of servers.splice(0)) await s.stop()
      await rm(dir, { recursive: true, force: true })
    })

    async function freshDatabaseUrl() {
      const admin = createDb(adminUrl())
      const name = `t_${Math.random().toString(36).slice(2, 10)}`
      await admin.pool.query(`create database ${name}`)
      await admin.close()
      const u = new URL(adminUrl())
      u.pathname = `/${name}`
      return u.toString()
    }

    async function boot(
      databaseUrl: string,
      model: () => ResolvedModel | Promise<ResolvedModel>,
      logger = createLogger({ level: 'silent' }),
    ) {
      const server = await startServer(
        {
          databaseUrl,
          host: '127.0.0.1',
          port: 0,
          secretsDir: join(dir, 'secrets'),
          siwcPort: 1455,
          siwcHost: '127.0.0.1',
          logLevel: 'silent',
        },
        { logger, resolveModel: async () => model() },
      )
      servers.push(server)
      const client: Client = createORPCClient(new RPCLink({ url: `${server.url}/rpc` }))
      return { server, client }
    }

    const fake = (script: Turn[], chunkDelayMs?: number) => {
      const model = fakeModel(script, { chunkSize: 2, ...(chunkDelayMs ? { chunkDelayMs } : {}) })
      return { model, resolved: { model, supportsTools: true } satisfies ResolvedModel }
    }

    /** A profile in a migrated database, written directly: profiles.create arrives later. */
    async function seededDatabase() {
      const url = await freshDatabaseUrl()
      const handle = createDb(url)
      await migrate(handle.db)
      const profileId = await seedProfile(handle.db)
      return { url, handle, profileId }
    }

    it('runs.start executes a Graphile job to succeeded with an assistant reply', async () => {
      const { url, handle, profileId } = await seededDatabase()
      await handle.close()
      const { model, resolved } = fake([{ text: 'Hello from the fake model' }])
      const { client } = await boot(url, () => resolved)

      const started = await client.runs.start({ profileId, prompt: 'Say hello' })
      expect(started.status).toBe('queued')

      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )

      const messages = await client.threads.messages({ threadId: started.threadId as never })
      expect(messages.map((m) => [m.role, m.parts])).toEqual([
        ['user', [{ type: 'text', text: 'Say hello' }]],
        ['assistant', [{ type: 'text', text: 'Hello from the fake model' }]],
      ])
      expect(model.calls).toHaveLength(1)
      const done = await client.runs.get({ id: started.id })
      expect(done).toMatchObject({ error: null, usage: { inputTokens: 10, outputTokens: 5 } })
      expect(done.startedAt).not.toBeNull()
      expect(done.endedAt).not.toBeNull()
    }, 60_000)

    it('a teammate created over RPC answers a run, and profiles errors are typed', async () => {
      const url = await freshDatabaseUrl()
      const { model, resolved } = fake([{ text: 'Hi from Ada' }])
      const { client } = await boot(url, () => resolved)
      const cred = await client.providers.create({
        provider: 'openai_compatible',
        label: 'Fake',
        baseUrl: 'http://127.0.0.1:9',
      } as never)
      const ada = await client.profiles.create({ name: 'Ada', modelMain: `${cred.id}:fake-echo` })
      expect(ada).toMatchObject({ slug: 'ada', archivedAt: null })
      expect((await client.profiles.list()).map((p) => p.id)).toEqual([ada.id])
      await expect(
        client.profiles.create({ name: 'Other', slug: 'ada', modelMain: ada.modelMain }),
      ).rejects.toMatchObject({ code: 'SLUG_TAKEN', data: { slug: 'ada' } })

      const started = await client.runs.start({ profileId: ada.id, prompt: 'hello' })
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )
      expect(model.calls).toHaveLength(1)
      await client.profiles.archive({ id: ada.id })
      expect(await client.profiles.list()).toEqual([])
    }, 60_000)

    it('a /ws subscriber sees the reply as run.delta events before the run.step and run.status that follow', async () => {
      const { url, handle, profileId } = await seededDatabase()
      await handle.close()
      const { resolved } = fake([{ text: 'Hello from the fake model' }], 25)
      const { client, server } = await boot(url, () => resolved)

      const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`)
      try {
        const live: Client = createORPCClient(new WsLink({ websocket: ws as never }))
        const stream = await live.events.subscribe({ topics: ['profile:*'] })
        const seen: { type: string; text?: string }[] = []
        const started = await client.runs.start({ profileId, prompt: 'Say hello' })
        for await (const event of stream) {
          const payload = event.payload as { text?: string; status?: string }
          seen.push({ type: event.type, ...(payload.text ? { text: payload.text } : {}) })
          if (event.type === 'run.status' && payload.status === 'succeeded') break
        }
        const deltas = seen.filter((e) => e.type === 'run.delta')
        expect(deltas.map((d) => d.text).join('')).toBe('Hello from the fake model')
        const lastDelta = seen.map((e) => e.type).lastIndexOf('run.delta')
        expect(seen.findIndex((e) => e.type === 'run.step')).toBeGreaterThan(lastDelta)
        expect(started.status).toBe('queued')
      } finally {
        ws.terminate()
      }
    }, 60_000)
    it('a model that is not configured fails the run with a closed code, not the job', async () => {
      const { url, handle, profileId } = await seededDatabase()
      await handle.close()
      const { ModelNotConfiguredError } = await import('@faire/core')
      const server = await startServer(
        {
          databaseUrl: url,
          host: '127.0.0.1',
          port: 0,
          secretsDir: join(dir, 'secrets'),
          siwcPort: 1455,
          siwcHost: '127.0.0.1',
          logLevel: 'silent',
        },
        {
          logger: createLogger({ level: 'silent' }),
          resolveModel: async () => {
            throw new ModelNotConfiguredError()
          },
        },
      )
      servers.push(server)
      const client: Client = createORPCClient(new RPCLink({ url: `${server.url}/rpc` }))
      const started = await client.runs.start({ profileId, prompt: 'hi' })
      await vi.waitFor(
        async () => {
          expect(await client.runs.get({ id: started.id })).toMatchObject({
            status: 'failed',
            error: 'model_not_configured',
          })
        },
        { timeout: 30_000, interval: 100 },
      )
    }, 60_000)

    it('runs.cancel stops an executing run and the run stays cancelled', async () => {
      const { url, handle, profileId } = await seededDatabase()
      const { model, resolved } = fake([{ text: 'x'.repeat(400) }], 25)
      const { client, server } = await boot(url, () => resolved)

      const started = await client.runs.start({ profileId, prompt: 'long please' })
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('running')
          expect(model.calls).toHaveLength(1)
        },
        { timeout: 30_000, interval: 50 },
      )

      expect((await client.runs.cancel({ id: started.id })).status).toBe('cancelled')
      await expect(client.runs.cancel({ id: started.id })).rejects.toMatchObject({
        code: 'CONFLICT',
        data: { from: 'cancelled', to: 'cancelled' },
      })

      await server.stop() // waits for the job to wind down
      const [row] = await handle.db.select().from(runs).where(eq(runs.id, started.id))
      expect(row?.status).toBe('cancelled')
      const msgs = await handle.db
        .select()
        .from(messages)
        .where(eq(messages.threadId, started.threadId as never))
      expect(msgs.map((m) => m.role)).toEqual(['user'])
      await handle.close()
    }, 90_000)

    it('runs.pause stops the job and runs.resume continues the run to success', async () => {
      const { url, handle, profileId } = await seededDatabase()
      const slow = fake([{ text: 'z'.repeat(400) }], 25)
      const quick = fake([{ text: 'resumed and done' }])
      let current = slow.resolved
      const { client } = await boot(url, () => current)

      const started = await client.runs.start({ profileId, prompt: 'pause me' })
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('running')
          expect(slow.model.calls).toHaveLength(1)
        },
        { timeout: 30_000, interval: 50 },
      )

      expect((await client.runs.pause({ id: started.id })).status).toBe('paused')
      current = quick.resolved
      expect((await client.runs.resume({ id: started.id })).status).toBe('queued')

      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )
      expect(quick.model.calls).toHaveLength(1)
      const msgs = await client.threads.messages({ threadId: started.threadId as never })
      expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
      expect(msgs[1]?.parts).toEqual([{ type: 'text', text: 'resumed and done' }])
      await handle.close()
    }, 90_000)

    it('a quick pause then resume still finishes: the new job waits for the old execution to unwind', async () => {
      const { url, handle, profileId } = await seededDatabase()
      const slow = fake([{ text: 'never used' }])
      const quick = fake([{ text: 'finished after the quick resume' }])
      // The first execution is parked inside model lookup, so pause cannot unwind it until the
      // gate opens. That is the window in which resume's new job meets the old registration.
      let open!: () => void
      const gate = new Promise<void>((resolve) => {
        open = resolve
      })
      let lookups = 0
      const lines: string[] = []
      const logger = createLogger({
        level: 'debug',
        stream: { write: (chunk: string) => void lines.push(chunk) },
      })
      const { client } = await boot(
        url,
        async () => {
          if (++lookups > 1) return quick.resolved
          await gate
          return slow.resolved
        },
        logger,
      )

      const started = await client.runs.start({ profileId, prompt: 'pause and resume fast' })
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('running')
          expect(lookups).toBe(1)
        },
        { timeout: 30_000, interval: 50 },
      )

      await client.runs.pause({ id: started.id })
      await client.runs.resume({ id: started.id })

      // The second job finds the first still registered and asks for a later retry.
      await vi.waitFor(() => expect(lines.join('')).toContain('still unwinding'), {
        timeout: 30_000,
        interval: 50,
      })
      open()

      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )
      expect(quick.model.calls).toHaveLength(1)
      expect(slow.model.calls).toHaveLength(0)
      await handle.close()
    }, 90_000)

    it('shutdown leaves a running run resumable and the next boot finishes it from its steps', async () => {
      const { url, handle, profileId } = await seededDatabase()
      const slow = fake([{ text: 'y'.repeat(400) }], 25)
      const first = await boot(url, () => slow.resolved)

      const started = await first.client.runs.start({ profileId, prompt: 'resume me' })
      await vi.waitFor(
        async () => {
          expect((await first.client.runs.get({ id: started.id })).status).toBe('running')
          expect(slow.model.calls).toHaveLength(1)
        },
        { timeout: 30_000, interval: 50 },
      )
      await first.server.stop()

      const [mid] = await handle.db.select().from(runs).where(eq(runs.id, started.id))
      expect(mid?.status).toBe('running')

      const second = fake([{ text: 'finished after restart' }])
      const { client } = await boot(url, () => second.resolved)
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: started.id })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )
      expect(second.model.calls).toHaveLength(1)
      const msgs = await client.threads.messages({ threadId: started.threadId as never })
      expect(msgs.at(-1)?.parts).toEqual([{ type: 'text', text: 'finished after restart' }])
      await handle.close()
    }, 90_000)

    it('boot recovery resumes a running run from its persisted steps and calls only the missing step', async () => {
      const { url, handle, profileId } = await seededDatabase()
      const threadId = await seedThread(handle.db, profileId)
      const runId: RunId = await seedRun(handle.db, profileId, {
        threadId,
        status: 'running',
        startedAt: new Date(),
      })
      await seedMessage(
        handle.db,
        threadId,
        'user',
        [{ type: 'text', text: 'crashed run' }],
        undefined,
        runId,
      )
      const store = createRunStore(handle.db)
      const usage = { inputTokens: 5, outputTokens: 5 }
      // Two steps were saved before the "crash": a tool call and its result.
      await store.appendStep(
        runId,
        {
          idx: 0,
          assistantMessages: [
            {
              role: 'assistant',
              content: [
                { type: 'text', text: 'Looking it up' },
                { type: 'tool-call', toolCallId: 'c1', toolName: 'lookup', input: { q: 'x' } },
              ],
            },
          ],
          toolMessages: [
            {
              role: 'tool',
              content: [
                {
                  type: 'tool-result',
                  toolCallId: 'c1',
                  toolName: 'lookup',
                  output: { type: 'json', value: { answer: 1 } },
                },
              ],
            },
          ],
          usage,
          activeMsDelta: 0,
        },
        usage,
      )
      await handle.close()

      const { model, resolved } = fake([{ text: 'The answer is 1' }])
      const { client } = await boot(url, () => resolved)
      await vi.waitFor(
        async () => {
          expect((await client.runs.get({ id: runId })).status).toBe('succeeded')
        },
        { timeout: 30_000, interval: 100 },
      )

      expect(model.calls).toHaveLength(1)
      expect((model.calls[0]?.prompt ?? []).map((m) => m.role)).toEqual([
        'system',
        'user',
        'assistant',
        'tool',
      ])
      const msgs = await client.threads.messages({ threadId })
      expect(msgs.at(-1)?.parts).toEqual([
        { type: 'text', text: 'Looking it up\n\nThe answer is 1' },
      ])
      expect((await client.runs.get({ id: runId })).usage).toEqual({
        inputTokens: 15,
        outputTokens: 10,
      })
    }, 90_000)
  })
}
