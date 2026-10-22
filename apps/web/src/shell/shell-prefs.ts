/** Per-viewer convenience: whether the desktop sidebar is shown. Open until the owner hides it. */
export const SIDEBAR_STORAGE_KEY = 'mawl.sidebar'
/** Per-viewer convenience: whether the wide-screen workspace panel is shown. */
export const PANEL_STORAGE_KEY = 'mawl.panel'

type ReadStorage = Pick<Storage, 'getItem'> | null
type WriteStorage = Pick<Storage, 'setItem'> | null

function loadOpen(storage: ReadStorage, key: string): boolean {
  try {
    return storage?.getItem(key) !== 'closed'
  } catch {
    return true
  }
}

function saveOpen(storage: WriteStorage, key: string, open: boolean): void {
  try {
    storage?.setItem(key, open ? 'open' : 'closed')
  } catch {
    // Storage can be full or blocked; the choice still applies until the next reload.
  }
}

/** Never throws: blocked storage and stale values fall back to open. */
export const loadSidebarOpen = (storage: ReadStorage) => loadOpen(storage, SIDEBAR_STORAGE_KEY)
export const saveSidebarOpen = (storage: WriteStorage, open: boolean) =>
  saveOpen(storage, SIDEBAR_STORAGE_KEY, open)

export const loadPanelOpen = (storage: ReadStorage) => loadOpen(storage, PANEL_STORAGE_KEY)
export const savePanelOpen = (storage: WriteStorage, open: boolean) =>
  saveOpen(storage, PANEL_STORAGE_KEY, open)
