import { readFileSync } from 'node:fs'

/** Replaced by esbuild `define` in the production bundle (see build.ts). */
declare const __FAIRE_VERSION__: string | undefined

/** The server version: baked in at build time, else read from this package's package.json. */
export function readVersion(): string {
  if (typeof __FAIRE_VERSION__ === 'string') return __FAIRE_VERSION__
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  return pkg.version
}
