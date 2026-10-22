import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { parseStatus, type Status } from './status.ts'

/** The splash's link to the desktop host (Rust commands in `apps/desktop/src-tauri/src/lib.rs`). */
export interface HostBridge {
  status(): Promise<Status>
  /** Resolves to an unsubscribe function. */
  onStatus(handler: (status: Status) => void): Promise<() => void>
  /** The text for "Copy diagnostics"; the host never puts the launch token in it. */
  diagnostics(): Promise<string>
  retry(): Promise<void>
  quit(): Promise<void>
  /** The splash finished its exit: load the app. */
  enterApp(): Promise<void>
  /** The first frame is painted: the window may show. */
  shown(): Promise<void>
}

export const STATUS_EVENT = 'mawl://supervisor'

export function tauriBridge(): HostBridge {
  return {
    status: async () => parseStatus(await invoke('supervisor_status')),
    onStatus: (handler) => listen(STATUS_EVENT, (event) => handler(parseStatus(event.payload))),
    diagnostics: () => invoke<string>('copy_diagnostics'),
    retry: () => invoke('retry_server'),
    quit: () => invoke('quit_app'),
    enterApp: () => invoke('enter_app'),
    shown: () => invoke('splash_shown'),
  }
}

export function inTauri(win: Window): boolean {
  return '__TAURI_INTERNALS__' in win
}
