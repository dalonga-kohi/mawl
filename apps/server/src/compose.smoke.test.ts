import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { contract } from '@faire/contracts'
import { dockerPolicy, isDockerAvailable } from '@faire/testkit'
import { createORPCClient } from '@orpc/client'
import { RPCLink } from '@orpc/client/fetch'
import type { ContractRouterClient } from '@orpc/contract'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const run = promisify(execFile)
const composeFile = fileURLToPath(
  new URL('../../../infra/compose/docker-compose.yml', import.meta.url),
)
const BUILD_TIMEOUT_MS = 600_000

/**
 * The real stack: builds the server image, boots it with Postgres through compose and talks to it
 * over HTTP. Runs in the default gate (a cold image build takes about a minute) under its own
 * project name, a random host port and its own image tag, so it never touches a stack the owner
 * runs. Skips without Docker locally; fails when CI or FAIRE_REQUIRE_DOCKER is set.
 */
describe('docker compose stack', () => {
  const project = `faire-smoke-${randomBytes(4).toString('hex')}`
  const password = randomBytes(24).toString('hex')
  let scratch: string | undefined
  let overrideFile = ''
  let baseUrl = ''
  let skipNote: string | undefined
  let started = false

  const compose = (args: string[]) =>
    run('docker', ['compose', '-p', project, '-f', composeFile, '-f', overrideFile, ...args], {
      env: { ...process.env, FAIRE_DB_PASSWORD: password },
      maxBuffer: 20 * 1024 * 1024,
    })

  beforeAll(async () => {
    const policy = dockerPolicy(await isDockerAvailable())
    if (policy === 'fail') {
      throw new Error('Docker is required (CI or FAIRE_REQUIRE_DOCKER is set) but is not available')
    }
    if (policy === 'skip') {
      skipNote = 'Docker is not available'
      process.stderr.write(`[compose-smoke] ${skipNote}: skipping the compose stack suite\n`)
      return
    }
    scratch = await mkdtemp(join(tmpdir(), 'faire-compose-'))
    overrideFile = join(scratch, 'override.yml')
    await writeFile(
      overrideFile,
      [
        'services:',
        '  server:',
        `    image: faire-server:${project}`,
        '    ports: !override',
        '      - "127.0.0.1::7420"',
        '',
      ].join('\n'),
    )
    started = true
    await compose(['up', '-d', '--build', '--wait', '--wait-timeout', '180'])
    const { stdout } = await compose(['port', 'server', '7420'])
    const port = stdout.trim().split(':').pop()
    baseUrl = `http://127.0.0.1:${port}`
  }, BUILD_TIMEOUT_MS)

  beforeEach((ctx) => {
    if (skipNote) ctx.skip(skipNote)
  })

  afterAll(async () => {
    if (started) await compose(['down', '-v', '--remove-orphans', '--rmi', 'local']).catch(() => {})
    if (scratch) await rm(scratch, { recursive: true, force: true })
  }, 120_000)

  it('answers /healthz once the database is reachable', async () => {
    await vi.waitFor(
      async () => {
        const res = await fetch(`${baseUrl}/healthz`)
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })
      },
      { timeout: 30_000, interval: 500 },
    )
  })

  it('serves the web app at / and at a client-side route, with hardening headers', async () => {
    for (const path of ['/', '/t']) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { accept: 'text/html' } })
      expect(res.status, path).toBe(200)
      expect(res.headers.get('content-type'), path).toContain('text/html')
      expect(res.headers.get('x-content-type-options'), path).toBe('nosniff')
      expect(await res.text(), path).toContain('id="root"')
    }
  })

  it('serves a hashed asset as immutable and 404s a missing one', async () => {
    const html = await (await fetch(`${baseUrl}/`, { headers: { accept: 'text/html' } })).text()
    const asset = /\/assets\/[^"']+\.js/.exec(html)?.[0]
    expect(asset).toBeDefined()
    const ok = await fetch(`${baseUrl}${asset}`)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('cache-control')).toContain('immutable')
    const missing = await fetch(`${baseUrl}/assets/missing.js`, {
      headers: { accept: 'text/html' },
    })
    expect(missing.status).toBe(404)
  })

  it('answers health.get over /rpc, so the server reached the database and migrated', async () => {
    const client: ContractRouterClient<typeof contract> = createORPCClient(
      new RPCLink({ url: `${baseUrl}/rpc` }),
    )
    await expect(client.health.get()).resolves.toMatchObject({ ok: true })
  })

  it('has Claude Code on PATH, logged out, with its config on the claude volume', async () => {
    const result = await compose(['exec', '-T', 'server', 'claude', 'auth', 'status']).then(
      (r) => ({ code: 0, stdout: r.stdout }),
      (err: { code?: number; stdout?: string }) => ({
        code: err.code ?? -1,
        stdout: err.stdout ?? '',
      }),
    )
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ loggedIn: false, configDirectory: '/claude' })
  })
})
