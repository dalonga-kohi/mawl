export interface PackageManifest {
  name?: string
  private?: boolean
  type?: string
  scripts?: Record<string, string>
  exports?: Record<string, string>
}

/** Returns a list of problems with a workspace package manifest (empty when valid). */
export function validateManifest(dir: string, manifest: PackageManifest): string[] {
  const problems: string[] = []
  const expectedName = `@mawl/${dir.split('/').at(-1)}`
  if (manifest.name !== expectedName) problems.push(`name must be ${expectedName}`)
  if (manifest.private !== true) problems.push('must be private')
  if (manifest.type !== 'module') problems.push('type must be module')
  for (const script of ['typecheck', 'test']) {
    if (!manifest.scripts?.[script]) problems.push(`missing script: ${script}`)
  }
  if (!manifest.exports?.['.']) problems.push('missing exports["."]')
  return problems
}
