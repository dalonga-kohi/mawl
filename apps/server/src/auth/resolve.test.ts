import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Config } from '../config.ts'
import { __resetSecretValues, scrubSecretValues } from '../redact.ts'
import { OWNER_TOKEN_FILE } from '../secrets/owner-token.ts'
import { resolveAuthToken } from './resolve.ts'

const LAUNCH = 'launch-token_0123456789abcdefghijklmnop'
const OWNER = 'owner-token_0123456789abcdefghijklmnopq'

describe('resolveAuthToken', () => {
  let dir: string
  let notices: string[]
  const base = (): Config => ({
    host: '127.0.0.1',
    port: 7420,
    secretsDir: dir,
    siwcPort: 1455,
    siwcHost: '127.0.0.1',
    logLevel: 'info',
  })
  const announce = (text: string) => void notices.push(text)

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'mawl-auth-'))
    notices = []
    __resetSecretValues()
  })
  afterEach(async () => {
    __resetSecretValues()
    await rm(dir, { recursive: true, force: true })
  })

  it('uses the launch token in desktop mode and writes no file', async () => {
    const token = await resolveAuthToken(
      { ...base(), mode: 'desktop', launchToken: LAUNCH },
      { announce },
    )
    expect(token).toBe(LAUNCH)
    expect(await readdir(dir)).toEqual([])
    expect(notices).toEqual([])
  })

  it('fails closed in desktop mode without a launch token, even with an owner token set', async () => {
    await expect(
      resolveAuthToken({ ...base(), mode: 'desktop', ownerToken: OWNER }, { announce }),
    ).rejects.toThrow(/launch token/)
  })

  it('uses MAWL_OWNER_TOKEN in headless mode without generating a file', async () => {
    expect(await resolveAuthToken({ ...base(), ownerToken: OWNER }, { announce })).toBe(OWNER)
    expect(await readdir(dir)).toEqual([])
    expect(notices).toEqual([])
    expect(scrubSecretValues(`x ${OWNER} y`)).toBe('x [Redacted] y')
  })

  it('generates the owner token once, announces it once with where to find it, and censors it in logs', async () => {
    const first = await resolveAuthToken(base(), { announce })
    expect(notices).toHaveLength(1)
    expect(notices[0]).toContain(first)
    expect(notices[0]).toContain(join(dir, OWNER_TOKEN_FILE))
    expect(scrubSecretValues(`x ${first} y`)).toBe('x [Redacted] y')

    const second = await resolveAuthToken(base(), { announce })
    expect(second).toBe(first)
    expect(notices).toHaveLength(1)
  })
})
