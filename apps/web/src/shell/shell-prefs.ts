/** Per-viewer convenience: whether the desktop sidebar is shown. Open until the owner hides it. */
export const SIDEBAR_STORAGE_KEY = 'mawl.sidebar'

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

/** Never throws: blocked storage and stale values fall back to open. */
export function loadSidebarOpen(storage: ReadStorage): boolean {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) !== 'closed'
  } catch {
    return true
  }
}

export function saveSidebarOpen(storage: WriteStorage, open: boolean): void {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, open ? 'open' : 'closed')
  } catch {
    // Storage can be full or blocked; the choice still applies until the next reload.
  }
}
