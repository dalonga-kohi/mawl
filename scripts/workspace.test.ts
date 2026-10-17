import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(import.meta.dirname, '..')

// The layout from docs/ARCHITECTURE.md section 2.
const expected = {
  apps: ['server', 'web', 'desktop', 'mobile'],
  packages: [
    'contracts',
    'core',
    'memory',
    'db',
    'sandbox',
    'channels',
    'ui',
    'ui-native',
    'mascot',
    'client',
    'testkit',
  ],
}

interface Manifest {
  name?: string
  scripts?: Record<string, string>
  exports?: Record<string, string>
  packageManager?: string
}

const readManifest = (dir: string): Manifest =>
  JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'))

const workspaceDirs = Object.entries(expected).flatMap(([group, names]) =>
  names.map((name) => `${group}/${name}`),
)

describe('workspace layout', () => {
  it('declares apps/* and packages/* in pnpm-workspace.yaml', () => {
    const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    expect(yaml).toMatch(/-\s+apps\/\*/)
    expect(yaml).toMatch(/-\s+packages\/\*/)
  })

  it('has every package listed in ARCHITECTURE section 2 and no extras', () => {
    for (const [group, names] of Object.entries(expected)) {
      const actual = readdirSync(join(root, group), { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(root, group, d.name, 'package.json')))
        .map((d) => d.name)
      expect(actual.sort()).toEqual([...names].sort())
    }
  })

  it('names every package @faire/<dir> and keeps names unique', () => {
    const names = workspaceDirs.map((dir) => readManifest(dir).name)
    expect(names).toEqual(workspaceDirs.map((dir) => `@faire/${dir.split('/')[1]}`))
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(workspaceDirs)('%s has typecheck, test and lint scripts', (dir) => {
    const scripts = readManifest(dir).scripts ?? {}
    expect(scripts.typecheck).toBeTruthy()
    expect(scripts.test).toBeTruthy()
    expect(scripts.lint).toBeTruthy()
  })

  it.each(workspaceDirs)('%s exports an entry file that exists', (dir) => {
    const entry = readManifest(dir).exports?.['.']
    expect(entry).toBeTruthy()
    expect(existsSync(join(root, dir, entry as string))).toBe(true)
  })

  it('pins pnpm 10.x as the package manager', () => {
    expect(readManifest('.').packageManager).toMatch(/^pnpm@10\./)
  })
})
