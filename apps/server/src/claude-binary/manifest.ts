import { z } from 'zod'

/**
 * What the build knows about the Claude Code binary: the SDK version the lockfile pins and, per
 * platform, the npm tarball that holds the unmodified binary plus the sha512 the lockfile records.
 * Public data, no secrets.
 */
export const ClaudeBinaryManifest = z.strictObject({
  // The version becomes a directory name: letters, digits, `.`, `+` and `-` only, and no `..`.
  version: z
    .string()
    .regex(/^[0-9A-Za-z][0-9A-Za-z.+-]*$/)
    .refine((v) => !v.includes('..')),
  packages: z.record(
    z.string().min(1),
    z.strictObject({
      url: z.url({ protocol: /^https$/ }),
      integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+=*$/),
    }),
  ),
})
export type ClaudeBinaryManifest = z.infer<typeof ClaudeBinaryManifest>

const SCOPE = '@anthropic-ai'
const PREFIX = 'claude-agent-sdk-'

/** The SDK's platform package suffix for this machine, or null when it ships no binary for it. */
export function platformKey(platform: string, arch: string, isMusl: boolean): string | null {
  if (arch !== 'x64' && arch !== 'arm64') return null
  if (platform === 'darwin' || platform === 'win32') return `${platform}-${arch}`
  if (platform === 'linux') return `linux-${arch}${isMusl ? '-musl' : ''}`
  return null
}

/** `'@anthropic-ai/claude-agent-sdk-<key>@<ver>':` then `resolution: {integrity: sha512-...}`. */
const ENTRY =
  /^ {2}'@anthropic-ai\/claude-agent-sdk-([a-z0-9-]+)@([^'(]+)':\r?\n {4}resolution: \{integrity: (sha512-[A-Za-z0-9+/]+=*)[,}]/gm

/**
 * Builds the manifest from pnpm-lock.yaml's `packages:` entries. Run at build time only: the
 * server never reads the lockfile at runtime. `snapshots:` entries carry no `resolution`, so they
 * never match.
 */
export function parseLockfileManifest(lockText: string): ClaudeBinaryManifest {
  const packages: Record<string, { url: string; integrity: string }> = {}
  const versions = new Set<string>()
  for (const [, key, version, integrity] of lockText.matchAll(ENTRY)) {
    if (!key || !version || !integrity) continue
    versions.add(version)
    packages[key] = {
      url: `https://registry.npmjs.org/${SCOPE}/${PREFIX}${key}/-/${PREFIX}${key}-${version}.tgz`,
      integrity,
    }
  }
  const [version, ...others] = [...versions]
  if (!version)
    throw new Error('pnpm-lock.yaml has no @anthropic-ai/claude-agent-sdk platform packages')
  if (others.length > 0) {
    throw new Error(
      `claude-agent-sdk platform packages must share one version, found ${[...versions].join(', ')}`,
    )
  }
  return ClaudeBinaryManifest.parse({ version, packages })
}
