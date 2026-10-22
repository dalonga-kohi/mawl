import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')
const raw = readFileSync(join(root, '.travis.yml'), 'utf8')

type Phase = string | string[] | undefined
type Job = { stage?: string; name?: string; before_script?: Phase; script?: Phase }
type Travis = {
  os?: string
  dist?: string
  language?: string
  node_js?: unknown
  services?: string[]
  if?: string
  env?: { global?: string[] }
  cache?: { directories?: string[] }
  before_install?: Phase
  install?: Phase
  jobs?: { include?: Job[] }
}

const travis = parse(raw) as Travis
const lines = (p: Phase) => (p === undefined ? [] : Array.isArray(p) ? p : [p])
const jobs = travis.jobs?.include ?? []
const env = travis.env?.global ?? []

describe('Travis CI config', () => {
  it('builds pushes to main and pull requests, not every branch push', () => {
    expect(travis.if).toMatch(/branch = main/)
    expect(travis.if).toMatch(/type = pull_request/)
  })

  it('runs Node from .nvmrc on a current Ubuntu image', () => {
    expect(travis.language).toBe('node_js')
    expect(travis).not.toHaveProperty('node_js')
    expect(travis.os).toBe('linux')
    expect(['jammy', 'noble']).toContain(travis.dist)
  })

  it('takes pnpm from packageManager through corepack, not a hard-coded version', () => {
    const before = lines(travis.before_install).join('\n')
    expect(before).toContain('corepack enable')
    expect(before).not.toMatch(/pnpm@\d/)
    expect(lines(travis.install)).toContain('pnpm install --frozen-lockfile')
  })

  it('has Docker and requires the Testcontainers suites to run, not skip', () => {
    expect(travis.services).toContain('docker')
    expect(env).toContain('CI=1')
    expect(env).toContain('MAWL_REQUIRE_DOCKER=1')
  })

  it('caches the pnpm store', () => {
    const dirs = travis.cache?.directories ?? []
    expect(dirs.some((d) => d.includes('pnpm-store'))).toBe(true)
  })

  it('runs only the Docker suites, in one job, since GitHub Actions covers the rest', () => {
    expect(jobs).toHaveLength(1)
    expect(lines(jobs[0]?.script)).toEqual(['pnpm test:docker'])
    expect(travis).not.toHaveProperty('stages')
    const code = raw.replace(/^\s*#.*$/gm, '')
    expect(code).not.toMatch(/turbo|playwright|lint|typecheck/)
  })

  it('selects the same suites the GitHub gate skips', () => {
    const rootScripts = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(rootScripts['test:docker']).toContain('.pg.test.ts')
  })

  it('carries no encrypted or plain secrets in the file', () => {
    expect(raw).not.toMatch(/\bsecure:/)
    expect(raw).not.toMatch(/(TOKEN|KEY|SECRET|PASSWORD)=/i)
  })
})
