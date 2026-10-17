import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
type Workflow = {
  on: Record<string, unknown>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown }
  jobs: Record<string, { 'runs-on'?: string; 'timeout-minutes'?: number; steps: Step[] }>
}

const raw = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
const workflow = parse(raw) as Workflow
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps)
const stepUsing = (action: string) => steps.find((s) => s.uses?.startsWith(`${action}@`))

describe('CI workflow', () => {
  it('runs on push to main, pull requests and manual dispatch', () => {
    expect(workflow.on.push).toEqual({ branches: ['main'] })
    expect(workflow.on).toHaveProperty('pull_request')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  it('never uses pull_request_target', () => {
    expect(workflow.on).not.toHaveProperty('pull_request_target')
    expect(raw).not.toContain('pull_request_target')
  })

  it('grants read-only contents permission and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('cancels superseded runs per ref only for pull requests', () => {
    expect(workflow.concurrency?.group).toContain('github.ref')
    expect(String(workflow.concurrency?.['cancel-in-progress'])).toContain('pull_request')
  })

  it('runs a single ubuntu job with a timeout', () => {
    const jobs = Object.values(workflow.jobs)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.['runs-on']).toBe('ubuntu-latest')
    expect(jobs[0]?.['timeout-minutes']).toBeGreaterThan(0)
  })

  it('reads the Node version from .nvmrc and caches pnpm', () => {
    const setupNode = stepUsing('actions/setup-node')
    expect(setupNode?.with?.['node-version-file']).toBe('.nvmrc')
    expect(setupNode?.with?.cache).toBe('pnpm')
  })

  it('takes the pnpm version from packageManager, not a hard-coded value', () => {
    const setupPnpm = stepUsing('pnpm/action-setup')
    expect(setupPnpm).toBeDefined()
    expect(setupPnpm?.with ?? {}).not.toHaveProperty('version')
  })

  it('installs with a frozen lockfile', () => {
    expect(steps.some((s) => s.run?.includes('pnpm install --frozen-lockfile'))).toBe(true)
  })

  it('runs the same gate as local: turbo lint typecheck test', () => {
    expect(steps.some((s) => s.run?.trim() === 'pnpm turbo lint typecheck test')).toBe(true)
  })

  it('persists the turbo cache keyed on OS, lockfile and sha with restore keys', () => {
    const cache = stepUsing('actions/cache')
    expect(cache?.with?.path).toBe('.turbo/cache')
    const key = String(cache?.with?.key)
    expect(key).toContain('runner.os')
    expect(key).toContain("hashFiles('pnpm-lock.yaml')")
    expect(key).toContain('github.sha')
    expect(String(cache?.with?.['restore-keys'])).toContain('runner.os')
  })

  it('pins every third-party action to a commit SHA or an exact version', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) {
      expect(ref).toMatch(/@([0-9a-f]{40}|v?\d+\.\d+\.\d+)$/)
    }
  })
})
