import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseLockfileManifest } from './manifest.ts'

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8')

describe('Docker image pin', () => {
  it('installs the same @anthropic-ai/claude-agent-sdk version the lockfile pins', () => {
    const pinned = parseLockfileManifest(read('../../../../pnpm-lock.yaml')).version
    const dockerfile = read('../../../../infra/docker/server.Dockerfile')
    const installed = /@anthropic-ai\/claude-agent-sdk@(\S+)/.exec(dockerfile)?.[1]
    // Bump both together: the image's binary and the desktop download must be one version.
    expect(installed).toBe(pinned)
  })
})
