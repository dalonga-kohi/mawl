import { describe, expect, it } from 'vitest'
import { validateManifest } from './validate-manifest'

const good = {
  name: '@faire/core',
  private: true,
  type: 'module',
  exports: { '.': './src/index.ts' },
  scripts: { typecheck: 'tsc --noEmit -p .', test: 'vitest run --passWithNoTests' },
}

describe('validateManifest', () => {
  it('accepts a well-formed package manifest', () => {
    expect(validateManifest('packages/core', good)).toEqual([])
  })

  it('rejects a name that is not @faire/<dir>', () => {
    expect(validateManifest('packages/core', { ...good, name: 'core' })).toContain(
      'name must be @faire/core',
    )
  })

  it('rejects a manifest that is not private', () => {
    expect(validateManifest('packages/core', { ...good, private: false })).toContain(
      'must be private',
    )
  })

  it('rejects a manifest that is not type module', () => {
    expect(validateManifest('packages/core', { ...good, type: 'commonjs' })).toContain(
      'type must be module',
    )
  })

  it('reports each missing typecheck or test script', () => {
    expect(validateManifest('packages/core', { ...good, scripts: {} })).toEqual([
      'missing script: typecheck',
      'missing script: test',
    ])
  })

  it('rejects a manifest without an exports entry', () => {
    expect(validateManifest('packages/core', { ...good, exports: {} })).toContain(
      'missing exports["."]',
    )
  })
})
