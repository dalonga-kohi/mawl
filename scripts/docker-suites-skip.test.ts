import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = join(import.meta.dirname, '..')

// Each package that owns Docker-backed suites, and the glob its config excludes when the fast
// GitHub gate sets MAWL_SKIP_DOCKER_SUITES. Travis runs these files by name (`pnpm test:docker`).
const configs = [
  ['apps/server', '**/*.pg.test.ts'],
  ['packages/db', '**/*.pg.test.ts'],
  ['packages/testkit', '**/postgres.smoke.test.ts'],
] as const

async function excludeFor(dir: string): Promise<string[]> {
  vi.resetModules()
  const mod = (await import(pathToFileURL(join(root, dir, 'vitest.config.ts')).href)) as {
    default: { test?: { exclude?: string[] } }
  }
  return mod.default.test?.exclude ?? []
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(configs)('%s vitest config', (dir, glob) => {
  it('keeps the Docker suites when MAWL_SKIP_DOCKER_SUITES is unset', async () => {
    vi.stubEnv('MAWL_SKIP_DOCKER_SUITES', '')
    expect(await excludeFor(dir)).not.toContain(glob)
  })

  it.each(['1', 'true'])('excludes the Docker suites when it is %s', async (v) => {
    vi.stubEnv('MAWL_SKIP_DOCKER_SUITES', v)
    const exclude = await excludeFor(dir)
    expect(exclude).toContain(glob)
    expect(exclude).toContain('**/node_modules/**')
  })

  it.each(['0', 'false'])('keeps them when it is %s', async (v) => {
    vi.stubEnv('MAWL_SKIP_DOCKER_SUITES', v)
    expect(await excludeFor(dir)).not.toContain(glob)
  })
})
