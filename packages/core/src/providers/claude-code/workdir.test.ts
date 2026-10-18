import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { LanguageModelV4CallOptions } from '@ai-sdk/provider'
import type { ProviderTestResult } from '@faire/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeQuery, msg } from './test-util.ts'

const prompt: LanguageModelV4CallOptions = {
  prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}
const okLogin = async (): Promise<ProviderTestResult> => ({ ok: true, latencyMs: 1 })
const script = () => [msg.start(), msg.success()]

const made: string[] = []

async function freshModelModule() {
  vi.resetModules()
  return await import('./model.ts')
}

async function runOnce(mod: Awaited<ReturnType<typeof freshModelModule>>) {
  const fq = fakeQuery(script())
  const m = mod.createClaudeCodeModel({ modelId: 'sonnet', query: fq.query, checkLogin: okLogin })
  await m.doGenerate(prompt)
  const cwd = fq.calls[0]?.options.cwd as string
  made.push(cwd)
  return cwd
}

afterEach(async () => {
  vi.doUnmock('node:fs/promises')
  vi.resetModules()
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true })
})

describe('claude work dir (hardening)', () => {
  it('is an unpredictable mkdtemp dir under the OS temp dir, different per process', async () => {
    const first = await runOnce(await freshModelModule())
    const second = await runOnce(await freshModelModule())
    expect(first).not.toBe(second)
    for (const dir of [first, second]) {
      expect(dirname(dir)).toBe(tmpdir())
      // mkdtemp appends six random characters to the prefix.
      expect(basename(dir)).toMatch(/^faire-claude-code-[A-Za-z0-9]{6}$/)
      expect((await stat(dir)).isDirectory()).toBe(true)
    }
  })

  it.skipIf(process.platform === 'win32')('is owner-only on POSIX', async () => {
    const dir = await runOnce(await freshModelModule())
    expect((await stat(dir)).mode & 0o077).toBe(0)
  })

  it('is not the fixed path an earlier version used', async () => {
    const dir = await runOnce(await freshModelModule())
    expect(dir).not.toBe(join(tmpdir(), 'faire-claude-code'))
  })

  it('creates the dir once for concurrent first calls in one process', async () => {
    const mod = await freshModelModule()
    const fqs = [fakeQuery(script()), fakeQuery(script()), fakeQuery(script())]
    await Promise.all(
      fqs.map((fq) =>
        mod
          .createClaudeCodeModel({ modelId: 'sonnet', query: fq.query, checkLogin: okLogin })
          .doGenerate(prompt),
      ),
    )
    const dirs = new Set(fqs.map((fq) => fq.calls[0]?.options.cwd))
    expect(dirs.size).toBe(1)
    made.push(...([...dirs] as string[]))
  })

  it('retries after a failed mkdtemp instead of keeping the failure for the whole process', async () => {
    let attempts = 0
    vi.resetModules()
    vi.doMock('node:fs/promises', async (importOriginal) => {
      const real = await importOriginal<typeof import('node:fs/promises')>()
      return {
        ...real,
        mkdtemp: (...args: Parameters<typeof real.mkdtemp>) => {
          attempts++
          if (attempts === 1) return Promise.reject(new Error('EACCES: /root/secret-path'))
          return real.mkdtemp(...args)
        },
      }
    })
    const mod = await import('./model.ts')
    const fq = fakeQuery(script())
    const m = mod.createClaudeCodeModel({ modelId: 'sonnet', query: fq.query, checkLogin: okLogin })
    const first = await m.doGenerate(prompt).then(
      () => undefined,
      (e: unknown) => e,
    )
    expect(first).toBeDefined()
    expect(fq.calls).toHaveLength(0)
    // Whatever the first failure looked like, it must not poison the next call.
    await m.doGenerate(prompt)
    expect(attempts).toBe(2)
    expect(fq.calls).toHaveLength(1)
    made.push(fq.calls[0]?.options.cwd as string)
  })
})
