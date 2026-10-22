import { resolveBundledClaudeBinary } from '@mawl/core'
import type { Logger } from '../logger.ts'
import { type EnsureClaudeBinaryOptions, ensureClaudeBinary } from './ensure.ts'
import type { ClaudeBinaryManifest } from './manifest.ts'

export interface ClaudeExecutableResolverOptions {
  /** MAWL_CLAUDE_CODE_PATH: the owner's own binary. Wins over everything. */
  explicitPath?: string | undefined
  /** Desktop mode's data dir. Without it (headless) nothing is ever downloaded. */
  dataDir?: string | undefined
  /** The build's pin. Without it (dev, tests) nothing is downloaded. */
  manifest?: ClaudeBinaryManifest | undefined
  logger: Pick<Logger, 'info' | 'warn'>
  onProgress?: EnsureClaudeBinaryOptions['onProgress']
  /** Injected in tests. */
  ensure?: typeof ensureClaudeBinary
  /** The SDK's own platform package beside the bundle (Docker). Injected in tests. */
  resolveBundled?: () => string | null
}

function detectMusl(): boolean {
  if (process.platform !== 'linux') return false
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } }
  return report?.header?.glibcVersionRuntime === undefined
}

/**
 * Where the Claude Code binary comes from, in order: the owner's path; the pinned version in the
 * data dir (downloaded first if missing; desktop mode only); otherwise the SDK's own platform
 * package installed beside the bundle (the Docker image), or undefined when there is none.
 * Nothing happens until the returned function is called.
 */
export function createClaudeExecutableResolver({
  explicitPath,
  dataDir,
  manifest,
  logger,
  onProgress,
  ensure = ensureClaudeBinary,
  resolveBundled = resolveBundledClaudeBinary,
}: ClaudeExecutableResolverOptions): (signal?: AbortSignal) => Promise<string | undefined> {
  return async (signal) => {
    if (explicitPath) return explicitPath
    // Bundled, the SDK cannot find a package beside itself, so it is always given a path.
    if (!dataDir || !manifest) {
      const bundled = resolveBundled()
      if (!bundled) {
        logger.warn(
          'no Claude Code binary found: set MAWL_CLAUDE_CODE_PATH or install the SDK package',
        )
      }
      return bundled ?? undefined
    }
    return ensure({
      dataDir,
      manifest,
      isMusl: detectMusl(),
      logger,
      ...(signal ? { signal } : {}),
      ...(onProgress ? { onProgress } : {}),
    })
  }
}
