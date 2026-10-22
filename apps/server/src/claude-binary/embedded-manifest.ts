import { ClaudeBinaryManifest } from './manifest.ts'

/** The manifest as JSON, replaced by esbuild `define` in the production bundle (see build.ts). */
declare const __MAWL_CLAUDE_MANIFEST__: string | undefined

/**
 * The pinned Claude binary the build recorded from pnpm-lock.yaml, or undefined when running from
 * source (dev, tests), where nothing is downloaded. `json` is for tests.
 */
export function embeddedClaudeManifest(
  json: string | undefined = typeof __MAWL_CLAUDE_MANIFEST__ === 'string'
    ? __MAWL_CLAUDE_MANIFEST__
    : undefined,
): ClaudeBinaryManifest | undefined {
  if (json === undefined) return undefined
  return ClaudeBinaryManifest.parse(JSON.parse(json))
}
