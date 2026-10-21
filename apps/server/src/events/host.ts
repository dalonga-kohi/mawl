export type HostCheck = { ok: true } | { ok: false; reason: 'host_not_allowed' }

export interface HostPolicy {
  /** The address the listener binds to (`MAWL_HOST`). Wildcards like 0.0.0.0 never match a Host. */
  bindHost: string
  /** `MAWL_ALLOWED_ORIGINS`: the owner's own hostnames. */
  allowedOrigins: readonly string[]
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]'])

/** The hostname of a `Host` header value or bare host, lowercase, IPv6 in brackets; undefined when it is not a plain host. */
function hostnameOf(value: string): string | undefined {
  const bare = !value.startsWith('[') && value.split(':').length > 2 ? `[${value}]` : value
  try {
    const url = new URL(`http://${bare}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      return undefined
    return url.hostname
  } catch {
    return undefined
  }
}

/**
 * DNS rebinding guard. A page on `evil.example` can make its name resolve to 127.0.0.1 and then
 * talk to the server as same-origin, so the Origin check alone is not enough: the `Host` header
 * (which the browser sets from the page's name) must be one of ours. Allowed: loopback names,
 * the bind address, and the hosts of `MAWL_ALLOWED_ORIGINS`. The port is not compared.
 */
export function checkHost(host: string | undefined, policy: HostPolicy): HostCheck {
  const deny = { ok: false, reason: 'host_not_allowed' } as const
  if (!host) return deny
  const name = hostnameOf(host)
  if (!name) return deny
  if (name === 'localhost' || name.endsWith('.localhost')) return { ok: true }
  if (name === '127.0.0.1' || name === '[::1]') return { ok: true }
  if (!WILDCARD_HOSTS.has(policy.bindHost) && hostnameOf(policy.bindHost) === name) {
    return { ok: true }
  }
  for (const origin of policy.allowedOrigins) {
    try {
      if (new URL(origin).hostname === name) return { ok: true }
    } catch {
      // Config validation already rejects these; ignore anything else.
    }
  }
  return deny
}
