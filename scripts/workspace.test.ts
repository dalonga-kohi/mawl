import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type PackageManifest, validateManifest } from './validate-manifest'

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

const readJson = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const readManifest = (dir: string): PackageManifest & { packageManager?: string } =>
  readJson(`${dir}/package.json`)

const workspaceDirs = Object.entries(expected).flatMap(([group, names]) =>
  names.map((name) => `${group}/${name}`),
)
const libraryDirs = expected.packages.map((name) => `packages/${name}`)

describe('workspace layout', () => {
  it('declares apps/* and packages/* in pnpm-workspace.yaml', () => {
    const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    expect(yaml).toMatch(/-\s+apps\/\*/)
    expect(yaml).toMatch(/-\s+packages\/\*/)
  })

  it('has every package listed in ARCHITECTURE section 2 and no extras', () => {
    for (const [group, names] of Object.entries(expected)) {
      const actual = readdirSync(join(root, group), { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
      expect(actual.sort()).toEqual([...names].sort())
    }
  })

  it('keeps package names unique', () => {
    const names = workspaceDirs.map((dir) => readManifest(dir).name)
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(workspaceDirs)('%s has a valid manifest', (dir) => {
    expect(validateManifest(dir, readManifest(dir))).toEqual([])
  })

  it.each(libraryDirs)('%s exports an entry file that exists', (dir) => {
    const entry = readManifest(dir).exports?.['.']
    expect(entry).toBeTruthy()
    expect(existsSync(join(root, dir, entry as string))).toBe(true)
  })

  it.each(workspaceDirs)('%s tsconfig extends the base and covers src and vitest config', (dir) => {
    const tsconfig = readJson(`${dir}/tsconfig.json`)
    expect(tsconfig.extends).toBe('../../tsconfig.base.json')
    expect(tsconfig.include).toEqual(['src', 'vitest.config.ts'])
  })

  it.each(workspaceDirs)('%s has an index test', (dir) => {
    expect(existsSync(join(root, dir, 'src/index.test.ts'))).toBe(true)
  })

  it('pins pnpm 10.x as the package manager', () => {
    expect(readManifest('.').packageManager).toMatch(/^pnpm@10\./)
  })
})
