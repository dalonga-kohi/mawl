import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'
import type { MascotState } from '../mascot/Beaver.tsx'

interface ShellApi {
  /** Context panel: inline at 1100 px and wider, a sheet below. */
  panelOpen: boolean
  setPanelOpen(open: boolean): void
  paletteOpen: boolean
  setPaletteOpen(open: boolean): void
  /** The rail mascot shows the focused teammate's state (DESIGN.md §8). */
  mascot: MascotState
  setMascot(state: MascotState): void
}

const ShellContext = createContext<ShellApi | null>(null)

export function ShellProvider({ children, wide }: { children: ReactNode; wide: boolean }) {
  // Wide screens start with the panel open; narrower ones keep the sheet closed until asked.
  const [wideOpen, setWideOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [mascot, setMascot] = useState<MascotState>('idle')
  const api = useMemo<ShellApi>(
    () => ({
      panelOpen: wide ? wideOpen : sheetOpen,
      setPanelOpen: wide ? setWideOpen : setSheetOpen,
      paletteOpen,
      setPaletteOpen,
      mascot,
      setMascot,
    }),
    [wide, wideOpen, sheetOpen, paletteOpen, mascot],
  )
  return <ShellContext value={api}>{children}</ShellContext>
}

export function useShell(): ShellApi {
  const api = useContext(ShellContext)
  if (!api) throw new Error('useShell must be used inside <ShellProvider>')
  return api
}
