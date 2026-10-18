import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDb } from '@faire/db'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { buildServer } from '../build.ts'

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

/** The bundle inlines graphile-worker; this proves its migrations and runner survive esbuild. */
export function describeBundleOnPostgres(adminUrl: () => string): void {
  describe('production bundle against real Postgres', () => {
    let out: string

    beforeAll(async () => {
      out = await mkdtemp(join(tmpdir(), 'faire-build-pg-'))
      await buildServer({ outdir: out })
    }, 60_000)

    afterAll(async () => {
      await rm(out, { recursive: true, force: true })
    })

    it('boots with the Graphile Worker, installs its schema and serves /healthz', async () => {
      const admin = createDb(adminUrl())
      const name = `t_${Math.random().toString(36).slice(2, 10)}`
      await admin.pool.query(`create database ${name}`)
      await admin.close()
      const u = new URL(adminUrl())
      u.pathname = `/${name}`
      const port = await freePort()

      const child = spawn(process.execPath, [join(out, 'server.mjs')], {
        cwd: out,
        env: {
          PATH: process.env.PATH ?? '',
          DATABASE_URL: u.toString(),
          FAIRE_SECRETS_DIR: join(out, 'secrets'),
          FAIRE_PORT: String(port),
          FAIRE_SIWC_PORT: String(await freePort()),
        },
      })
      const chunks: string[] = []
      child.stdout.on('data', (d) => chunks.push(String(d)))
      child.stderr.on('data', (d) => chunks.push(String(d)))
      try {
        await vi.waitFor(
          () => {
            const output = chunks.join('')
            if (output.includes('boot failed')) throw new Error(`boot failed: ${output}`)
            expect(output).toContain('run worker started')
            expect(output).toContain('listening')
          },
          { timeout: 30_000, interval: 100 },
        )
        const res = await fetch(`http://127.0.0.1:${port}/healthz`)
        expect(res.status).toBe(200)

        const db = createDb(u.toString())
        try {
          const { rows } = await db.pool.query(
            "select to_regclass('graphile_worker.jobs') as jobs, to_regclass('runs') as runs",
          )
          expect(rows[0]).toEqual({ jobs: 'graphile_worker.jobs', runs: 'runs' })
        } finally {
          await db.close()
        }
      } finally {
        // Wait for the exit: on Windows the child's working directory stays locked until then.
        const exited = new Promise<void>((resolve) => child.once('close', () => resolve()))
        child.kill()
        await exited
      }
    }, 90_000)
  })
}
