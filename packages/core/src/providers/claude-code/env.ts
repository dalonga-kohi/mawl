/**
 * Variables the Claude Code subprocess may inherit. Everything else is dropped, so a stray
 * ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN or CLAUDE_CODE_USE_* in Faire's own environment can
 * never make the binary bill another account. The subscription login lives in the config dir
 * (CLAUDE_CONFIG_DIR, else the home directory), which the binary reads itself: Faire does not.
 */
const ALLOWED = new Set(
  [
    'PATH',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
    'APPDATA',
    'LOCALAPPDATA',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'SystemRoot',
    'SystemDrive',
    'windir',
    'ComSpec',
    'CLAUDE_CONFIG_DIR',
    'NODE_EXTRA_CA_CERTS',
    'HTTPS_PROXY',
    'HTTP_PROXY',
    'NO_PROXY',
  ].map((name) => name.toLowerCase()),
)

export interface ClaudeEnvOptions {
  /** Defaults to `process.env`, read at call time. */
  env?: Record<string, string | undefined>
  /** Faire's own setting (FAIRE_CLAUDE_CONFIG_DIR). Wins over an inherited CLAUDE_CONFIG_DIR. */
  configDir?: string | undefined
}

/** A clean environment for the Claude Code binary: the allowlist above, nothing else. */
export function buildClaudeEnv({
  env = process.env,
  configDir,
}: ClaudeEnvOptions = {}): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(env)) {
    // Names are matched case-insensitively (Windows has Path and PATH) but keep their spelling.
    if (value === undefined || value === '' || !ALLOWED.has(name.toLowerCase())) continue
    out[name] = value
  }
  if (configDir) {
    for (const name of Object.keys(out)) {
      if (name.toLowerCase() === 'claude_config_dir') delete out[name]
    }
    out.CLAUDE_CONFIG_DIR = configDir
  }
  return out
}
