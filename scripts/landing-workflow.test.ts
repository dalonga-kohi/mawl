import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> }
type Workflow = {
  jobs: Record<string, { steps: Step[] }>
}

const workflow = parse(
  readFileSync(join(root, '.github/workflows/landing.yml'), 'utf8'),
) as Workflow
const steps = workflow.jobs.deploy?.steps ?? []
const stepUsing = (action: string) => steps.find((s) => s.uses?.startsWith(`${action}@`))

describe('landing workflow', () => {
  it('sets up pnpm before running wrangler deploy', () => {
    const setupPnpm = stepUsing('pnpm/action-setup')
    const deploy = stepUsing('cloudflare/wrangler-action')
    expect(setupPnpm).toBeDefined()
    expect(deploy).toBeDefined()
    if (!setupPnpm || !deploy) throw new Error('expected setup and deploy steps')
    expect(steps.indexOf(setupPnpm)).toBeLessThan(steps.indexOf(deploy))
  })

  it('reads the Node version from .nvmrc and does not hard-code pnpm version', () => {
    const setupNode = stepUsing('actions/setup-node')
    const setupPnpm = stepUsing('pnpm/action-setup')
    expect(setupNode?.with?.['node-version-file']).toBe('.nvmrc')
    expect(setupPnpm?.with ?? {}).not.toHaveProperty('version')
  })

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })
})
