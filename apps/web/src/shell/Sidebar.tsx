import { Link, useRouterState } from '@tanstack/react-router'
import { PanelLeftClose, Search, Settings, User } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { transitions } from '../motion/presets.ts'
import { ProfileDialog } from '../profile/ProfileDialog.tsx'
import { useProfile } from '../profile/useProfile.ts'
import { NewTeammateDialog } from '../teammates/NewTeammateDialog.tsx'
import { TeammateList } from '../teammates/TeammateList.tsx'
import { buttonVariants } from '../ui/Button.tsx'
import { cn } from '../ui/cn.ts'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/Sheet.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { paletteShortcutLabel } from './CommandPalette.tsx'
import { MAIN_NAV, type NavItem } from './nav.ts'
import { useShell } from './ShellContext.tsx'
import { sidebarShortcutLabel } from './shortcuts.ts'

export const SIDEBAR_WIDTH = 280

/** A full-width pill row: icon, label, and an optional trailing hint. */
const rowClass = cn(
  'accent-tween flex h-10 w-full items-center gap-3 rounded-pill px-3 text-left text-body text-text pointer-coarse:h-11',
  'hover:bg-surface-2 active:scale-[.97] aria-[current=page]:bg-surface-2',
  '[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-text-2 aria-[current=page]:[&_svg]:text-accent-ink',
)

function NavLink({ item, trailing }: { item: NavItem; trailing?: ReactNode }) {
  const Icon = item.icon
  return (
    <Link to={item.to} className={rowClass}>
      <Icon aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      {trailing}
    </Link>
  )
}

/**
 * The pending-approvals count pill.
 * reason: no approvals data source exists yet; U5 wires the count in. Until then no pill shows.
 */
function ApprovalsCount(): ReactNode {
  return null
}

function SearchRow() {
  const { setPaletteOpen } = useShell()
  return (
    <button type="button" className={rowClass} onClick={() => setPaletteOpen(true)}>
      <Search aria-hidden="true" />
      <span className="flex-1">Search</span>
      <kbd className="font-ui text-micro text-text-3">{paletteShortcutLabel()}</kbd>
    </button>
  )
}

function Header() {
  const { hideSidebar } = useShell()
  return (
    <div className="flex items-center gap-2.5 px-2">
      <span className="flex-1 font-display text-[1.5rem] leading-none font-[650] tracking-tight">
        Mawl
      </span>
      <Tooltip label={`Hide sidebar (${sidebarShortcutLabel()})`} side="right">
        <button
          type="button"
          aria-label="Hide sidebar"
          onClick={hideSidebar}
          className={buttonVariants({ variant: 'ghost', size: 'icon' })}
        >
          <PanelLeftClose aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  )
}

/** One compact row: the profile button fills it, the Settings gear sits at the right. */
function Footer() {
  const { profile } = useProfile()
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex items-center gap-1 pt-1">
      <button
        type="button"
        className={cn(
          'accent-tween flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-pill pr-3 pl-1.5 text-left text-heading text-text',
          'hover:bg-surface-2 active:scale-[.97] pointer-coarse:h-12',
        )}
        onClick={() => setEditing(true)}
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-pill bg-accent-soft text-heading text-accent-ink"
        >
          {profile.name ? (
            profile.name.slice(0, 1).toUpperCase()
          ) : (
            <User className="size-4 text-accent-ink" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{profile.name || 'Set your name'}</span>
      </button>
      <Tooltip label="Settings" side="top">
        <Link
          to="/settings"
          aria-label="Settings"
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            'aria-[current=page]:bg-surface-2 aria-[current=page]:text-accent-ink',
          )}
        >
          <Settings aria-hidden="true" />
        </Link>
      </Tooltip>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function SidebarBody() {
  const [creating, setCreating] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pt-3.5 pr-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-3">
      <Header />
      <nav aria-label="Main" className="flex flex-col gap-0.5">
        <SearchRow />
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.to}
            item={item}
            trailing={item.to === '/approvals' ? <ApprovalsCount /> : null}
          />
        ))}
      </nav>
      <TeammateList onNewTeammate={() => setCreating(true)} />
      <Footer />
      <NewTeammateDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
/**
 * The one navigation surface: a 280 px column that hides completely, or below 760 px a drawer from
 * the left (UI-REDESIGN.md §5). There is no icon rail and no bottom tab bar.
 */
export function Sidebar() {
  const { compact, sidebarOpen, drawerOpen, setDrawerOpen } = useShell()
  const href = useRouterState({ select: (s) => s.location.href })

  // Going anywhere closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the location is the trigger, not a value read
  useEffect(() => setDrawerOpen(false), [href, setDrawerOpen])

  if (compact) {
    return (
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent
          side="left"
          aria-describedby={undefined}
          className="gap-0 p-0"
          onOpenAutoFocus={(e) => {
            // Focus the drawer itself: landing on the Hide button would pop its tooltip open.
            e.preventDefault()
            ;(e.currentTarget as HTMLElement | null)?.focus()
          }}
        >
          <SheetTitle className="sr-only">Sidebar</SheetTitle>
          <SheetDescription className="sr-only">Navigation and your teammates</SheetDescription>
          <SidebarBody />
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <AnimatePresence initial={false}>
      {sidebarOpen ? (
        <motion.aside
          key="sidebar"
          aria-label="Sidebar"
          className="shrink-0 overflow-hidden border-r border-line"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: SIDEBAR_WIDTH, opacity: 1, transition: transitions.gentle }}
          exit={{ width: 0, opacity: 0, transition: transitions.exit }}
        >
          <div className="h-full" style={{ width: SIDEBAR_WIDTH }}>
            <SidebarBody />
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
