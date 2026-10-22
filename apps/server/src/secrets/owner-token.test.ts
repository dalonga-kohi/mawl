import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AUTH_TOKEN_PATTERN } from '@mawl/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadOrCreateOwnerToken, OWNER_TOKEN_FILE, OwnerTokenError } from './owner-token.ts'

describe('loadOrCreateOwnerToken', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mawl-owner-token-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('creates a 32-byte base64url token on first boot and says so', async () => {
    const first = await loadOrCreateOwnerToken(dir)
    expect(first.created).toBe(true)
    expect(first.token).toMatch(AUTH_TOKEN_PATTERN)
    expect(Buffer.from(first.token, 'base64url')).toHaveLength(32)
    expect((await readFile(join(dir, OWNER_TOKEN_FILE), 'utf8')).trim()).toBe(first.token)
  })

  it('reuses the stored token on later boots', async () => {
    const first = await loadOrCreateOwnerToken(dir)
    const second = await loadOrCreateOwnerToken(dir)
    expect(second).toEqual({ token: first.token, created: false })
  })

  it('creates the directory when it is missing', async () => {
    const nested = join(dir, 'a', 'b')
    expect((await loadOrCreateOwnerToken(nested)).created).toBe(true)
  })

  it('ends concurrent first boots with one token, created exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => loadOrCreateOwnerToken(dir)))
    expect(new Set(results.map((r) => r.token)).size).toBe(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
  })

  it('refuses a file that does not hold a token, without echoing it or replacing it', async () => {
    const file = join(dir, OWNER_TOKEN_FILE)
    await writeFile(file, 'not a token LEAK-ME\n')
    const err = await loadOrCreateOwnerToken(dir).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(OwnerTokenError)
    expect(String((err as Error).message)).not.toContain('LEAK-ME')
    expect(String((err as Error).message)).toContain(file)
    expect(await readFile(file, 'utf8')).toBe('not a token LEAK-ME\n')
  })

  it.skipIf(process.platform === 'win32')('writes the file with mode 0600', async () => {
    await loadOrCreateOwnerToken(dir)
    expect((await stat(join(dir, OWNER_TOKEN_FILE))).mode & 0o777).toBe(0o600)
  })
})
