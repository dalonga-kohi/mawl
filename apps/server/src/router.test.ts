import { contract } from '@faire/contracts'
import { call, isProcedure, traverseContractProcedures } from '@orpc/server'
import { describe, expect, it } from 'vitest'
import { createRouter } from './router.ts'

const router = createRouter({ version: '9.9.9' })

function contractPaths(): string[][] {
  const paths: string[][] = []
  traverseContractProcedures({ path: [], router: contract }, ({ path }) => {
    paths.push([...path])
  })
  return paths
}

const at = (path: string[]): unknown =>
  path.reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], router)

describe('createRouter', () => {
  it('implements every procedure in the contract', () => {
    const paths = contractPaths()
    expect(paths.length).toBeGreaterThan(15)
    for (const path of paths) expect(isProcedure(at(path)), path.join('.')).toBe(true)
  })

  it('health.get reports ok and the version', async () => {
    expect(await call(router.health.get, undefined)).toEqual({ ok: true, version: '9.9.9' })
  })

  it.each([
    ['settings', 'get'],
    ['devices', 'list'],
    ['profiles', 'list'],
  ])('%s.%s is a 501 NOT_IMPLEMENTED stub', async (group, name) => {
    const proc = at([group as string, name as string]) as never
    await expect(call(proc, undefined as never)).rejects.toMatchObject({
      code: 'NOT_IMPLEMENTED',
      status: 501,
    })
  })
})
