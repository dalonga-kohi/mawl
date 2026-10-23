import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')
// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
const runnerTemp = '${{ runner.temp }}'
// biome-ignore lint/suspicious/noTemplateCurlyInString: Literal GitHub Actions expression.
const workspace = '${{ github.workspace }}'

type Step = {
  name?: string
  uses?: string
  run?: string
  'working-directory'?: string
  with?: Record<string, unknown>
}
type Workflow = {
  jobs: Record<string, { steps: Step[] }>
}

const workflow = parse(
  readFileSync(join(root, '.github/workflows/landing.yml'), 'utf8'),
) as Workflow
const steps = workflow.jobs.deploy?.steps ?? []
const stepUsing = (action: string) => steps.find((s) => s.uses?.startsWith(`${action}@`))

describe('landing workflow', () => {
  it('installs deployment tools in a separate npm project instead of the pnpm workspace root', () => {
    const prepare = steps.find((step) => step.run?.includes('npm init --yes'))
    const deploy = stepUsing('cloudflare/wrangler-action')
    expect(prepare).toBeDefined()
    expect(deploy).toBeDefined()
    if (!prepare || !deploy) throw new Error('expected isolated setup and deploy steps')
    expect(steps.indexOf(prepare)).toBeLessThan(steps.indexOf(deploy))
    expect(prepare['working-directory']).toBe(runnerTemp)
    expect(deploy.with?.packageManager).toBe('npm')
    expect(deploy.with?.workingDirectory).toBe(`${runnerTemp}/mawl-pages`)
    expect(deploy.with?.wranglerVersion).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('reads the Node version from .nvmrc and publishes only the static site directory', () => {
    const setupNode = stepUsing('actions/setup-node')
    const deploy = stepUsing('cloudflare/wrangler-action')
    expect(setupNode?.with?.['node-version-file']).toBe('.nvmrc')
    expect(deploy?.with?.command).toBe(
      `pages deploy "${workspace}/site" --project-name=mawl --branch=main`,
    )
  })

  it('pins every action to a full commit SHA', () => {
    const uses = steps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })
})
