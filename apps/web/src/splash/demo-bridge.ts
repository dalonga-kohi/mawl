import type { HostBridge } from './bridge.ts'
import { parseStatus, type Status } from './status.ts'

/**
 * Development only: the splash outside Tauri (`vite` + `/splash.html?demo=...`), so its states can
 * be looked at in a browser. `demo=boot` walks the real sequence; any other value is one fixed
 * status, e.g. `demo=failed`, `demo=restarting`, `demo=stopping`.
 */
const FIXED: Record<string, Status> = {
  database: { phase: 'starting', stage: 'database' },
  server: { phase: 'starting', stage: 'server' },
  ready: { phase: 'ready' },
  restarting: {
    phase: 'restarting',
    attempt: 2,
    reason: { kind: 'unhealthy' },
    retry_in_ms: 2000,
  },
  stopping: { phase: 'stopping' },
  failed: { phase: 'failed', reason: { kind: 'exited', code: 1 } },
  missing: { phase: 'failed', reason: { kind: 'not_installed' } },
}

export function demoBridge(demo: string): HostBridge {
  const listeners = new Set<(s: Status) => void>()
  const emit = (s: Status) => {
    for (const l of listeners) l(s)
  }
  const first = FIXED[demo] ?? FIXED.database
  return {
    status: async () => parseStatus(first),
    onStatus: async (handler) => {
      listeners.add(handler)
      if (demo === 'boot') {
        setTimeout(() => emit({ phase: 'starting', stage: 'server' }), 1800)
        setTimeout(() => emit({ phase: 'ready' }), 3200)
      }
      return () => listeners.delete(handler)
    },
    diagnostics: async () => 'Mawl diagnostics (demo)\n[host] server exited with code 1\n',
    retry: async () => emit({ phase: 'starting', stage: 'database' }),
    quit: async () => emit({ phase: 'stopping' }),
    enterApp: async () => {
      document.body.dataset.entered = 'true'
    },
    shown: async () => {},
  }
}
