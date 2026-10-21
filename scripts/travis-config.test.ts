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
  stages?: Array<string | { name: string }>
  jobs?: { include?: Job[] }
}

const travis = parse(raw) as Travis
const lines = (p: Phase) => (p === undefined ? [] : Array.isArray(p) ? p : [p])
const jobs = travis.jobs?.include ?? []
const jobInStage = (stage: string) => jobs.find((j) => j.stage === stage)
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

  it('caches the pnpm store and the turbo cache', () => {
    const dirs = travis.cache?.directories ?? []
    expect(dirs).toContain('.turbo/cache')
    expect(dirs.some((d) => d.includes('pnpm-store'))).toBe(true)
  })

  it('runs the gate stage before the e2e stage', () => {
    const names = (travis.stages ?? []).map((s) => (typeof s === 'string' ? s : s.name))
    expect(names).toEqual(['gate', 'e2e'])
  })

  it('runs the same gate as local: turbo lint typecheck test', () => {
    expect(lines(jobInStage('gate')?.script)).toContain('pnpm turbo lint typecheck test')
  })

  it('installs Chromium before running the browser e2e suite', () => {
    const e2e = jobInStage('e2e')
    expect(lines(e2e?.before_script).join('\n')).toMatch(/playwright install --with-deps chromium/)
    expect(lines(e2e?.script)).toContain('pnpm test:e2e')
  })

  it('carries no encrypted or plain secrets in the file', () => {
    expect(raw).not.toMatch(/\bsecure:/)
    expect(raw).not.toMatch(/(TOKEN|KEY|SECRET|PASSWORD)=/i)
  })
})
