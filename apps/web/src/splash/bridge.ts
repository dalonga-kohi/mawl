import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  type ConnectError,
  type HostAppearance,
  parseConnectError,
  parseHealth,
  parseHostAppearance,
  parseTarget,
  type RemoteHealth,
  type Target,
} from './remote.ts'
import { parseStatus, type Status } from './status.ts'

export type ConnectResult = { ok: true } | { ok: false; error: ConnectError }

/** The splash's link to the desktop host (Rust commands in `apps/desktop/src-tauri/src/lib.rs`). */
export interface HostBridge {
  status(): Promise<Status>
  /** Resolves to an unsubscribe function. */
  onStatus(handler: (status: Status) => void): Promise<() => void>
  /** The text for "Copy diagnostics"; the host never puts a token in it. */
  diagnostics(): Promise<string>
  retry(): Promise<void>
  quit(): Promise<void>
  /** The splash finished its exit: load the app. */
  enterApp(): Promise<void>
  /** The first frame is painted: the window may show. */
  shown(): Promise<void>
  /** This PC's server, or the remote Mawl the owner connected to (its origin only). */
  target(): Promise<Target>
  /** Remote target only: asks the remote to prove it knows the stored token. */
  checkRemote(): Promise<RemoteHealth>
  /**
   * Checks the address and the token, and on success saves them and restarts Mawl on the remote.
   * The token goes to the host here and nowhere else: never into a URL, storage or a log.
   */
  connectRemote(url: string, token: string): Promise<ConnectResult>
  /** Forgets the remote and restarts Mawl on this PC's server. */
  switchToLocal(): Promise<ConnectResult>
}

export const STATUS_EVENT = 'mawl://supervisor'

const settle = (call: Promise<unknown>): Promise<ConnectResult> =>
  call.then(
    () => ({ ok: true }) as const,
    (error: unknown) => ({ ok: false, error: parseConnectError(error) }) as const,
  )

export function tauriBridge(): HostBridge {
  return {
    status: async () => parseStatus(await invoke('supervisor_status')),
    onStatus: (handler) => listen(STATUS_EVENT, (event) => handler(parseStatus(event.payload))),
    diagnostics: () => invoke<string>('copy_diagnostics'),
    retry: () => invoke('retry_server'),
    quit: () => invoke('quit_app'),
    enterApp: () => invoke('enter_app'),
    shown: () => invoke('splash_shown'),
    target: async () => parseTarget(await invoke('host_target')),
    checkRemote: async () => parseHealth(await invoke('check_remote')),
    connectRemote: (url, token) => settle(invoke('connect_remote', { url, token })),
    switchToLocal: () => settle(invoke('use_local_mawl')),
  }
}

/** The owner's theme and accent as the host last saw them in the app, or `null`. */
export async function hostAppearance(): Promise<HostAppearance | null> {
  try {
    return parseHostAppearance(await invoke('splash_appearance'))
  } catch {
    return null
  }
}

export function inTauri(win: Window): boolean {
  return '__TAURI_INTERNALS__' in win
}
