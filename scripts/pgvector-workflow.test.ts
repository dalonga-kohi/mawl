import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')
const read = (p: string) => readFileSync(join(root, p), 'utf8')

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
type Workflow = {
  on: { push?: { paths?: string[] }; pull_request?: { paths?: string[] }; [k: string]: unknown }
  permissions?: Record<string, string>
  jobs: Record<string, { 'runs-on'?: string; 'timeout-minutes'?: number; steps: Step[] }>
}

const workflow = parse(read('.github/workflows/pgvector-windows.yml')) as Workflow
const job = workflow.jobs.pgvector
const steps = job?.steps ?? []
const script = read('infra/desktop/pgvector/build-vector-msvc.ps1')
const fetchPg = read('infra/desktop/fetch-pg.ps1')
const RUNNER_TEMP_EXPR = '$' + '{{ runner.temp }}'
const constant = (src: string, name: string) =>
  new RegExp(`\\$${name}\\s*=\\s*'([^']+)'`).exec(src)?.[1]

describe('pgvector Windows workflow', () => {
  it('runs on windows-2025 with a timeout and read-only permissions', () => {
    expect(job?.['runs-on']).toBe('windows-2025')
    expect(job?.['timeout-minutes']).toBeGreaterThan(0)
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('never triggers on pull_request_target', () => {
    expect(Object.keys(workflow.on)).not.toContain('pull_request_target')
  })

  it('runs on PRs and main only when the desktop inputs change, and on demand', () => {
    for (const trigger of [workflow.on.push, workflow.on.pull_request]) {
      expect(trigger?.paths).toContain('infra/desktop/**')
      expect(trigger?.paths).toContain('.github/workflows/pgvector-windows.yml')
    }
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })

  it('calls an existing build script and uploads its output, failing when it is empty', () => {
    const build = steps.find((s) => s.run?.includes('build-vector-msvc.ps1'))
    expect(build).toBeDefined()
    expect(existsSync(join(root, 'infra/desktop/pgvector/build-vector-msvc.ps1'))).toBe(true)
    const upload = steps.find((s) => s.uses?.startsWith('actions/upload-artifact@'))
    expect(upload?.with?.['if-no-files-found']).toBe('error')
    const outDir = /-Out\s+"([^"]+)"/.exec(build?.run ?? '')?.[1] ?? ''
    expect(outDir.replace('$env:RUNNER_TEMP', '').replace(/\\/g, '/')).toBe(
      String(upload?.with?.path).replace(RUNNER_TEMP_EXPR, ''),
    )
  })

  it('never interpolates expressions inside run scripts', () => {
    for (const s of steps) expect(s.run ?? '').not.toContain('${{')
  })
})

describe('build-vector-msvc.ps1', () => {
  it('pins the same EDB zip as fetch-pg.ps1', () => {
    const zip = constant(script, 'PgZipSha256')
    expect(zip).toMatch(/^[0-9A-F]{64}$/)
    expect(zip).toBe(constant(fetchPg, 'Sha256'))
    expect(constant(script, 'PgVersion')).toBe(constant(fetchPg, 'Version'))
  })

  it('pins postgres.exe, the pgvector tag and its commit', () => {
    expect(constant(script, 'PgExeSha256')).toMatch(/^[0-9A-F]{64}$/)
    expect(constant(script, 'VectorTag')).toBe('v0.8.7')
    expect(constant(script, 'VectorCommit')).toMatch(/^[0-9a-f]{8,40}$/)
  })

  it('builds with nmake, runs installcheck and fails on a bad exit code', () => {
    expect(script).toContain('Makefile.win')
    expect(script).toContain('installcheck')
    expect(script).toContain('$LASTEXITCODE -ne 0')
  })

  it('downloads over HTTPS only', () => {
    expect(script).toContain("--proto '=https' --proto-redir '=https'")
    expect(script).not.toMatch(/http:\/\//)
  })
})
