import { randomBytes } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { vector } from '@electric-sql/pglite-pgvector'
import { ProviderCredential } from '@faire/contracts'
import { migrationsFolder, schema } from '@faire/db'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createLogger } from '../logger.ts'
import { createSecretBox } from '../secrets/index.ts'
import { type ClaudeCodeOptions, createProviderService } from './service.ts'

const { providerCredentials } = schema

const status = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.com', ...over })

describe('Claude subscription provider on the server (PGlite)', () => {
  let client: PGlite
  let db: ReturnType<typeof drizzle<typeof schema>>
  let logLines: string[]

  beforeEach(async () => {
    client = new PGlite({ extensions: { vector } })
    db = drizzle(client, { schema })
    await migrate(db, { migrationsFolder })
    logLines = []
  })
  afterEach(() => client.close())

  async function makeService(claudeCode: ClaudeCodeOptions) {
    const secretBox = await createSecretBox(new Uint8Array(randomBytes(32)))
    const logger = createLogger({
      level: 'trace',
      stream: { write: (chunk: string) => void logLines.push(chunk) },
    })
    return createProviderService({ db, secretBox, logger, claudeCode })
  }

  it('creates a label-only credential: public shape, no secret, no base url', async () => {
    const service = await makeService({})
    const created = await service.create({
      provider: 'anthropic_claude_code',
      label: 'My Claude plan',
    })
    expect(ProviderCredential.safeParse(created).success).toBe(true)
    expect(created).toMatchObject({
      provider: 'anthropic_claude_code',
      label: 'My Claude plan',
      baseUrl: null,
      accountEmail: null,
      planUsage: false,
      reauthRequired: false,
    })
    expect(await service.resolveCredential(created.id)).toEqual({
      kind: 'anthropic_claude_code',
      baseUrl: null,
      secret: null,
    })
    const [row] = await db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, created.id))
    expect(row?.oauthClientId).toBeNull()
  })

  it('tests by id with the binary: ok, not signed in, wrong auth method', async () => {
    let out = status()
    const calls: string[][] = []
    const service = await makeService({
      resolveBinary: () => '/opt/claude',
      run: async (_cmd, args) => {
        calls.push(args)
        return { stdout: out }
      },
    })
    const { id } = await service.create({ provider: 'anthropic_claude_code', label: 'c' })
    expect((await service.test({ id })).ok).toBe(true)
    expect(calls[0]).toEqual(['auth', 'status'])

    out = status({ loggedIn: false, authMethod: 'none' })
    expect(await service.test({ id })).toEqual({ ok: false, reason: 'not_signed_in' })
    out = status({ authMethod: 'api_key' })
    expect(await service.test({ id })).toEqual({ ok: false, reason: 'wrong_auth_method' })
  })

  it('tests an unsaved input the same way and writes nothing', async () => {
    const service = await makeService({
      resolveBinary: () => '/opt/claude',
      run: async () => ({ stdout: status() }),
    })
    const res = await service.test({ provider: 'anthropic_claude_code', label: 'c' })
    expect(res.ok).toBe(true)
    expect(await db.select().from(providerCredentials)).toHaveLength(0)
  })

  it('never logs the binary output or the owner email while testing', async () => {
    const service = await makeService({
      resolveBinary: () => '/opt/claude',
      run: async () => ({ stdout: status() }),
    })
    const { id } = await service.create({ provider: 'anthropic_claude_code', label: 'c' })
    await service.test({ id })
    expect(logLines.join('')).not.toContain('owner@example.com')
  })

  it('builds a model that runs the binary with the configured config dir', async () => {
    const seen: Array<{ prompt: string; env: Record<string, string | undefined> | undefined }> = []
    const service = await makeService({
      configDir: '/data/claude',
      pathToClaudeCodeExecutable: '/opt/claude',
      checkLogin: async () => ({ ok: true, latencyMs: 1 }),
      query: (params) => {
        seen.push({ prompt: params.prompt, env: params.options.env })
        return (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            is_error: false,
            stop_reason: 'end_turn',
            usage: { input_tokens: 1, output_tokens: 1 },
          }
        })()
      },
    })
    const { id } = await service.create({ provider: 'anthropic_claude_code', label: 'c' })
    const model = await service.createModel(id, 'sonnet')
    await model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
    expect(seen[0]?.prompt).toBe('hi')
    expect(seen[0]?.env?.CLAUDE_CONFIG_DIR).toBe('/data/claude')
  })
})
