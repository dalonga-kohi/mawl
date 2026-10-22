import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

type Step = {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}
type Workflow = {
  on: Record<string, unknown>
  env?: Record<string, string>
  permissions?: Record<string, string>
  concurrency?: { group?: string; 'cancel-in-progress'?: unknown }
  jobs: Record<
    string,
    { 'runs-on'?: string; 'timeout-minutes'?: number; env?: Record<string, string>; steps: Step[] }
  >
}
type Dependabot = {
  updates: {
    'package-ecosystem': string
    schedule: { interval: string }
    groups?: Record<string, unknown>
  }[]
}

const workflow = parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')) as Workflow
const dependabot = parse(readFileSync(join(root, '.github/dependabot.yml'), 'utf8')) as Dependabot
const job = workflow.jobs.gate
const steps = job?.steps ?? []

const isGate = (s: Step) =>
  /\bturbo\b/.test(s.run ?? '') && ['lint', 'typecheck', 'test'].every((t) => s.run?.includes(t))
const isInstall = (s: Step) => Boolean(s.run?.includes('pnpm install'))
const isTurboCache = (s: Step) => Boolean(s.uses?.startsWith('actions/cache@'))
const stepUsing = (action: string) => steps.find((s) => s.uses?.startsWith(`${action}@`))

describe('CI workflow', () => {
  it('runs on push to main, pull requests and manual dispatch', () => {
    expect(workflow.on.push).toEqual({ branches: ['main'] })
    expect(workflow.on).toHaveProperty('pull_request')
    expect(workflow.on).toHaveProperty('workflow_dispatch')
  })

  it('never triggers on pull_request_target', () => {
    expect(Object.keys(workflow.on)).not.toContain('pull_request_target')
  })

  it('grants read-only contents permission and nothing else', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' })
  })

  it('cancels superseded runs per ref only for pull requests', () => {
    expect(workflow.concurrency?.group).toContain('github.ref')
    expect(String(workflow.concurrency?.['cancel-in-progress'])).toContain('pull_request')
  })

  it('runs the gate job on ubuntu with a timeout', () => {
    expect(job?.['runs-on']).toBe('ubuntu-latest')
    expect(job?.['timeout-minutes']).toBeGreaterThan(0)
  })

  it('skips the Docker suites, which Travis runs, so no test runs twice', () => {
    expect(job?.env).toEqual({ MAWL_SKIP_DOCKER_SUITES: '1' })
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
    expect(steps.some(isGate)).toBe(true)
  })

  it('installs, then restores the turbo cache, then runs turbo', () => {
    const install = steps.findIndex(isInstall)
    const cache = steps.findIndex(isTurboCache)
    const gate = steps.findIndex(isGate)
    expect(install).toBeGreaterThanOrEqual(0)
    expect(install).toBeLessThan(cache)
    expect(cache).toBeLessThan(gate)
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

  it('pins every third-party action to a full commit SHA, since tags are mutable', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) {
      expect(ref).toMatch(/@[0-9a-f]{40}$/)
    }
  })

  it('exposes secrets only to the turbo step, not to install scripts', () => {
    const gate = steps.find(isGate)
    const others = [workflow.env, job?.env, ...steps.filter((s) => s !== gate).map((s) => s)]
    expect(JSON.stringify(others)).not.toContain('secrets.')
    expect(JSON.stringify(gate?.env)).toContain('secrets.TURBO_TOKEN')
  })

  it('never interpolates expressions inside run scripts', () => {
    for (const s of steps) {
      expect(s.run ?? '').not.toContain('${{')
    }
  })
})

describe('dependabot config', () => {
  it.each(['github-actions', 'npm'])('updates %s weekly with grouped minor/patch', (eco) => {
    const entry = dependabot.updates.find((u) => u['package-ecosystem'] === eco)
    expect(entry).toBeDefined()
    expect(entry?.schedule.interval).toBe('weekly')
    expect(Object.keys(entry?.groups ?? {}).length).toBeGreaterThan(0)
  })
})
