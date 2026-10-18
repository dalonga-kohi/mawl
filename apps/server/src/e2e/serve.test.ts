import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runNode } from '../run-node.test-util.ts'

describe('e2e server entry', () => {
  it('refuses to start without FAIRE_E2E=1, before touching Docker', async () => {
    const { code, output } = await runNode(['--import', 'tsx', 'src/e2e/serve.ts'], {
      cwd: join(import.meta.dirname, '..', '..'),
      env: {},
    })
    expect(code).toBe(1)
    expect(output).toContain('FAIRE_E2E=1')
  }, 60_000)
})
