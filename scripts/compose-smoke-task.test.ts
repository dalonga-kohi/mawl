import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

type TestConfig = { include?: string[]; exclude?: string[] }

async function load(file: string): Promise<TestConfig> {
  vi.resetModules()
  const mod = (await import(pathToFileURL(join(root, file)).href)) as {
    default: { test?: TestConfig }
  }
  return mod.default.test ?? {}
}

const scripts = (file: string) =>
  (JSON.parse(readFileSync(join(root, file), 'utf8')) as { scripts: Record<string, string> })
    .scripts

afterEach(() => {
  vi.unstubAllEnvs()
})

// The compose smoke test builds the server image (about a minute), so it has its own task and
// neither `pnpm test` nor `pnpm test:docker` may run it.
describe('compose smoke test task', () => {
  it.each(['', '1'])(
    'is excluded from the default server test run (MAWL_SKIP_DOCKER_SUITES=%j)',
    async (v) => {
      vi.stubEnv('MAWL_SKIP_DOCKER_SUITES', v)
      const config = await load('apps/server/vitest.config.ts')
      expect(config.exclude).toContain('**/compose.smoke.test.ts')
    },
  )

  it('is the only file the dedicated config runs, whatever MAWL_SKIP_DOCKER_SUITES says', async () => {
    vi.stubEnv('MAWL_SKIP_DOCKER_SUITES', '1')
    const config = await load('apps/server/vitest.compose.config.ts')
    expect(config.include).toEqual(['src/compose.smoke.test.ts'])
    expect(config.exclude ?? []).not.toContain('**/compose.smoke.test.ts')
  })

  it('is reachable as test:compose from the server package and the repo root', () => {
    expect(scripts('apps/server/package.json')['test:compose']).toBe(
      'vitest run --config vitest.compose.config.ts',
    )
    expect(scripts('package.json')['test:compose']).toBe('turbo test:compose')
    const turbo = JSON.parse(readFileSync(join(root, 'turbo.json'), 'utf8')) as {
      tasks: Record<string, { cache?: boolean }>
    }
    expect(turbo.tasks['test:compose']).toEqual({ cache: false })
  })

  it('does not run in the default root test:docker selection', () => {
    expect(scripts('package.json')['test:docker']).not.toMatch(/compose/)
  })

  it('runs on Travis as a second step of the one Docker job, not on the fast GitHub gate', () => {
    const travis = parse(readFileSync(join(root, '.travis.yml'), 'utf8')) as {
      jobs: { include: { script: string[] }[] }
    }
    expect(travis.jobs.include).toHaveLength(1)
    expect(travis.jobs.include[0]?.script).toEqual(['pnpm test:docker', 'pnpm test:compose'])
    expect(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).not.toMatch(/test:compose/)
  })
})
