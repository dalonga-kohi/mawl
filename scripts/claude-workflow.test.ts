import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(import.meta.dirname, '..')

type Step = { uses?: string; run?: string; with?: Record<string, unknown>; env?: unknown }
type Job = {
  if?: string
  'timeout-minutes'?: number
  permissions?: Record<string, string>
  steps: Step[]
}
type Workflow = { on: Record<string, unknown>; permissions?: unknown; jobs: Record<string, Job> }

const workflow = parse(readFileSync(join(root, '.github/workflows/claude.yml'), 'utf8')) as Workflow
const jobs = Object.entries(workflow.jobs)
const allSteps = jobs.flatMap(([, j]) => j.steps)
const isClaude = (s: Step) => Boolean(s.uses?.startsWith('anthropics/claude-code-action@'))

describe('Claude Code workflow', () => {
  it('never triggers on pull_request_target, which would run fork code with secrets', () => {
    expect(Object.keys(workflow.on)).not.toContain('pull_request_target')
  })

  it('grants nothing at the top level; each job asks for its own permissions', () => {
    expect(workflow.permissions).toEqual({})
    for (const [name, job] of jobs) {
      expect(job.permissions, name).toBeDefined()
      expect(job['timeout-minutes'], name).toBeGreaterThan(0)
    }
  })

  it('reviews only non-draft pull requests opened from this repository, not forks', () => {
    const review = workflow.jobs.review
    expect(review?.if).toContain("github.event_name == 'pull_request'")
    expect(review?.if).toContain(
      'github.event.pull_request.head.repo.full_name == github.repository',
    )
    expect(review?.if).toContain('!github.event.pull_request.draft')
    expect(review?.permissions?.contents).toBe('read')
  })

  it('answers @claude only for the owner, members and collaborators', () => {
    const mention = workflow.jobs.mention
    expect(mention?.if).toContain("'@claude'")
    expect(mention?.if).toContain('author_association')
    expect(mention?.if).toMatch(/OWNER/)
    expect(mention?.if).not.toMatch(/CONTRIBUTOR|FIRST_TIME|NONE/)
  })

  it('pins every action to a full commit SHA, since tags are mutable', () => {
    const uses = allSteps.map((s) => s.uses).filter((u): u is string => Boolean(u))
    expect(uses.length).toBeGreaterThan(0)
    for (const ref of uses) expect(ref).toMatch(/@[0-9a-f]{40}$/)
  })

  it('passes the secret only to the Claude action step', () => {
    for (const s of allSteps) {
      const hasSecret = JSON.stringify(s).includes('secrets.')
      expect(hasSecret, s.uses ?? s.run).toBe(isClaude(s))
    }
    expect(allSteps.filter(isClaude).length).toBe(2)
  })

  it('never interpolates expressions inside run scripts', () => {
    for (const s of allSteps) expect(s.run ?? '').not.toContain('${{')
  })

  it('never puts the PR title or body into the prompt', () => {
    for (const s of allSteps.filter(isClaude)) {
      expect(String(s.with?.prompt ?? '')).not.toMatch(/pull_request\.(title|body)|comment\.body/)
    }
  })
})
