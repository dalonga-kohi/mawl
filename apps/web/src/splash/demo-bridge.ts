import type { ConnectResult, HostBridge } from './bridge.ts'
import type { HostAppearance, RemoteHealth, Target } from './remote.ts'
import { parseStatus, type Status } from './status.ts'

/**
 * Development only: the splash outside Tauri (`vite` + `/splash.html?demo=...`), so its states can
 * be looked at in a browser. `demo=boot` walks the real sequence; any other value is one fixed
 * status, e.g. `demo=failed`, `demo=restarting`, `demo=stopping`. `demo=remote` checks a remote
 * Mawl that answers, `demo=remote-down` one that never answers; add `&connect` for the form. Connecting
 * with the token `wrong-token-wrong-token-wrong-token` shows a refusal; any address starting with
 * `https://down` shows an unreachable one. `look=dark|light|ocean` previews a saved appearance.
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

const REMOTE: Target = { kind: 'remote', origin: 'https://mawl.tail1234.ts.net/' }

const LOOKS: Record<string, HostAppearance> = {
  dark: { theme: 'dark', accent: null, reduceMotion: false },
  light: { theme: 'light', accent: null, reduceMotion: false },
  ocean: { theme: 'dark', accent: '#3A7BD5', reduceMotion: true },
}

export function demoAppearance(look: string): HostAppearance | null {
  return LOOKS[look] ?? null
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function demoBridge(demo: string): HostBridge {
  const listeners = new Set<(s: Status) => void>()
  const emit = (s: Status) => {
    for (const l of listeners) l(s)
  }
  const first = FIXED[demo] ?? FIXED.database
  const target: Target = demo.startsWith('remote') ? REMOTE : { kind: 'local' }
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
    target: async () => target,
    checkRemote: async (): Promise<RemoteHealth> => {
      await wait(900)
      return demo === 'remote-down' ? 'unreachable' : 'ready'
    },
    connectRemote: async (url, token): Promise<ConnectResult> => {
      await wait(900)
      if (!url.trim()) return { ok: false, error: { kind: 'url', reason: 'empty' } }
      if (!token.trim()) return { ok: false, error: { kind: 'token', reason: 'empty' } }
      if (url.trim().startsWith('https://down')) {
        return { ok: false, error: { kind: 'remote', health: 'unreachable' } }
      }
      if (token.includes('wrong')) {
        return { ok: false, error: { kind: 'remote', health: 'token_refused' } }
      }
      return { ok: true }
    },
    switchToLocal: async (): Promise<ConnectResult> => ({ ok: true }),
  }
}
