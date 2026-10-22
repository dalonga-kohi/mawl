// Production bundle: `pnpm --filter @mawl/server build` -> dist/server.mjs (+ dist/drizzle).
// Workspace packages are plain TypeScript with extensionless imports, so they are bundled in;
// npm dependencies are bundled too, which keeps the runtime image to one file plus the SQL.
import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { parseLockfileManifest } from './claude-binary/manifest.ts'

const lockfile = fileURLToPath(new URL('../../../pnpm-lock.yaml', import.meta.url))
const serverDir = fileURLToPath(new URL('..', import.meta.url))
const migrationsSource = fileURLToPath(new URL('../../../packages/db/drizzle', import.meta.url))

export interface BuildOptions {
  /** Defaults to apps/server/dist. */
  outdir?: string
}

export async function buildServer({
  outdir = fileURLToPath(new URL('../dist', import.meta.url)),
}: BuildOptions = {}): Promise<void> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  // The pin comes from the lockfile at build time; the server never reads it at runtime.
  const claudeManifest = parseLockfileManifest(await readFile(lockfile, 'utf8'))
  await rm(outdir, { recursive: true, force: true })
  await mkdir(outdir, { recursive: true })

  await build({
    absWorkingDir: serverDir,
    entryPoints: ['src/main.ts'],
    outfile: `${outdir}/server.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    // pg tries to load the optional native binding and falls back to JS when absent.
    // The Claude Agent SDK's JS (~1.3 MB) is bundled like everything else. The SDK cannot find its
    // native binary from inside a bundle, so the server always hands it an explicit path: the
    // first-use download in desktop mode (claude-binary/), the image's install in Docker.
    external: ['pg-native'],
    define: {
      __MAWL_VERSION__: JSON.stringify(pkg.version),
      // JSON as a string literal; claude-binary/embedded-manifest.ts parses and validates it.
      __MAWL_CLAUDE_MANIFEST__: JSON.stringify(JSON.stringify(claudeManifest)),
    },
    // CommonJS dependencies (pg, pino) call require() on node builtins.
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module';const require = __createRequire(import.meta.url);",
    },
    logLevel: 'warning',
  })

  await cp(migrationsSource, `${outdir}/drizzle`, { recursive: true })
}

if (import.meta.main) {
  await buildServer()
}
