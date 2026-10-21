import { PanelLeftOpen } from 'lucide-react'
import { IconButton } from '../ui/Button.tsx'
import { useShell } from './ShellContext.tsx'

/**
 * Brings the sidebar back. Shown in every page header while the desktop sidebar is hidden, and
 * always below 760 px, where the sidebar is a drawer. Renders nothing when the sidebar is in view.
 */
export function ShowSidebarButton() {
  const { compact, sidebarOpen, showSidebar } = useShell()
  if (!compact && sidebarOpen) return null
  return (
    <IconButton label="Show sidebar" tooltipSide="right" onClick={showSidebar}>
      <PanelLeftOpen aria-hidden="true" />
    </IconButton>
  )
}
