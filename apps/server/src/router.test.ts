import { type CredentialId, contract } from '@faire/contracts'
import { PROVIDER_DESCRIPTORS } from '@faire/core'
import { call, isProcedure, traverseContractProcedures } from '@orpc/server'
import { describe, expect, it } from 'vitest'
import {
  CredentialNotFoundError,
  CredentialUnreadableError,
  type ProviderService,
} from './providers/service.ts'
import { unusedProviders } from './providers/test-util.ts'
import { createRouter } from './router.ts'

const CRED = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V8' as CredentialId
const UNREADABLE = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6VA' as CredentialId
const publicRow = {
  id: CRED,
  provider: 'openai' as const,
  label: 'Work',
  baseUrl: null,
  accountEmail: null,
  planUsage: false,
  reauthRequired: false,
  createdAt: '2026-01-02T03:04:05.000Z',
}

const providers: ProviderService = {
  ...unusedProviders,
  list: async () => [publicRow],
  create: async () => publicRow,
  delete: async (id) => {
    if (id !== CRED) throw new CredentialNotFoundError(id)
    return { ...publicRow, revoked: true }
  },
  test: async (target) => {
    if ('id' in target && target.id === UNREADABLE) throw new CredentialUnreadableError(target.id)
    if ('id' in target && target.id !== CRED) throw new CredentialNotFoundError(target.id)
    return { ok: true, latencyMs: 3 }
  },
}

const router = createRouter({ version: '9.9.9', providers })

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

describe('providers procedures', () => {
  it('catalog lists a descriptor per provider kind', async () => {
    const out = await call(router.providers.catalog, undefined)
    expect(out).toEqual(Object.values(PROVIDER_DESCRIPTORS))
  })

  it('list and create return what the service returns', async () => {
    expect(await call(router.providers.list, undefined)).toEqual([publicRow])
    expect(
      await call(router.providers.create, { provider: 'openai', label: 'Work', secret: 'x' }),
    ).toEqual(publicRow)
  })

  it('delete and test answer typed NOT_FOUND for an unknown id', async () => {
    const other = 'cred_01HZX3K9V2M4N6P8Q0R2S4T6V9' as CredentialId
    await expect(call(router.providers.delete, { id: other })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      data: { entity: 'credential', id: other },
    })
    await expect(call(router.providers.test, { id: other })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
  })

  it('test answers typed CREDENTIAL_UNREADABLE when the stored key cannot be decrypted', async () => {
    await expect(call(router.providers.test, { id: UNREADABLE })).rejects.toMatchObject({
      code: 'CREDENTIAL_UNREADABLE',
      status: 409,
      data: { id: UNREADABLE },
    })
  })

  it('test accepts a stored id', async () => {
    expect(await call(router.providers.test, { id: CRED })).toEqual({ ok: true, latencyMs: 3 })
  })
})
