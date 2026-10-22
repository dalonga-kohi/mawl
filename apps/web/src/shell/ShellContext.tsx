import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { MascotState } from '../mascot/states.ts'
import { loadPanelOpen, loadSidebarOpen, savePanelOpen, saveSidebarOpen } from './shell-prefs.ts'

interface ShellApi {
  /** Context panel: inline at 1100 px and wider, a sheet below. */
  panelOpen: boolean
  setPanelOpen(open: boolean): void
  paletteOpen: boolean
  setPaletteOpen(open: boolean): void
  /** The sidebar mascot shows the focused teammate's state (DESIGN.md §8). */
  mascot: MascotState
  setMascot(state: MascotState): void
  /** Below 760 px the sidebar is a drawer instead of a column. */
  compact: boolean
  /** Desktop: is the sidebar column shown? Remembered between visits. */
  sidebarOpen: boolean
  /** Compact: is the drawer open? */
  drawerOpen: boolean
  setDrawerOpen(open: boolean): void
  /** Whichever of column or drawer applies at this width is visible. */
  sidebarVisible: boolean
  showSidebar(): void
  hideSidebar(): void
  toggleSidebar(): void
}

const ShellContext = createContext<ShellApi | null>(null)

const isSidebarShortcut = (e: KeyboardEvent) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b'

export function ShellProvider({
  children,
  wide,
  medium,
}: {
  children: ReactNode
  wide: boolean
  medium: boolean
}) {
  // Wide screens start with the panel open unless the owner hid it; narrower ones keep the sheet
  // closed until asked (the sheet is never remembered).
  const [wideOpen, setWideOpenState] = useState(() => loadPanelOpen(window.localStorage))
  const [sheetOpen, setSheetOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mascot, setMascot] = useState<MascotState>('idle')
  const [sidebarOpen, setSidebarOpenState] = useState(() => loadSidebarOpen(window.localStorage))
  const [drawerOpen, setDrawerOpen] = useState(false)
  const compact = !medium

  const setWideOpen = useCallback((open: boolean) => {
    setWideOpenState(open)
    savePanelOpen(window.localStorage, open)
  }, [])

  const setSidebarOpen = useCallback((open: boolean) => {
    setSidebarOpenState(open)
    saveSidebarOpen(window.localStorage, open)
  }, [])

  const sidebarVisible = compact ? drawerOpen : sidebarOpen
  const setVisible = useCallback(
    (open: boolean) => (compact ? setDrawerOpen(open) : setSidebarOpen(open)),
    [compact, setSidebarOpen],
  )

  // Ctrl+B / Cmd+B toggles the sidebar from anywhere, typing included.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSidebarShortcut(e)) return
      e.preventDefault()
      setVisible(!sidebarVisible)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setVisible, sidebarVisible])

  const api = useMemo<ShellApi>(
    () => ({
      panelOpen: wide ? wideOpen : sheetOpen,
      setPanelOpen: wide ? setWideOpen : setSheetOpen,
      paletteOpen,
      setPaletteOpen,
      mascot,
      setMascot,
      compact,
      sidebarOpen,
      drawerOpen,
      setDrawerOpen,
      sidebarVisible,
      showSidebar: () => setVisible(true),
      hideSidebar: () => setVisible(false),
      toggleSidebar: () => setVisible(!sidebarVisible),
    }),
    [
      wide,
      wideOpen,
      sheetOpen,
      paletteOpen,
      mascot,
      compact,
      sidebarOpen,
      drawerOpen,
      sidebarVisible,
      setVisible,
      setWideOpen,
    ],
  )
  return <ShellContext value={api}>{children}</ShellContext>
}

export function useShell(): ShellApi {
  const api = useContext(ShellContext)
  if (!api) throw new Error('useShell must be used inside <ShellProvider>')
  return api
}
