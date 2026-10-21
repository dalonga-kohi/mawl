import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router'
import { PanelLeftClose, Search, SquarePen, User } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Mawl } from '../mascot/Mawl.tsx'
import { transitions } from '../motion/presets.ts'
import { ProfileDialog } from '../profile/ProfileDialog.tsx'
import { useProfile } from '../profile/useProfile.ts'
import { NewTeammateDialog } from '../teammates/NewTeammateDialog.tsx'
import { useProfiles } from '../teammates/queries.ts'
import { TeammateList } from '../teammates/TeammateList.tsx'
import { Button, buttonVariants } from '../ui/Button.tsx'
import { cn } from '../ui/cn.ts'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '../ui/Sheet.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { paletteShortcutLabel } from './CommandPalette.tsx'
import { MAIN_NAV, type NavItem, SETTINGS_NAV } from './nav.ts'
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
  const { mascot, hideSidebar } = useShell()
  return (
    <div className="flex items-center gap-2.5 px-2">
      <Mawl size={28} state={mascot} />
      <span className="flex-1 font-display text-heading">Mawl</span>
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

function Footer() {
  const { profile } = useProfile()
  const [editing, setEditing] = useState(false)
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <NavLink item={SETTINGS_NAV} />
      <button
        type="button"
        className={cn(rowClass, 'h-14 pointer-coarse:h-14')}
        onClick={() => setEditing(true)}
      >
        <span
          aria-hidden="true"
          className="grid size-9 shrink-0 place-items-center rounded-pill bg-accent-soft text-heading text-accent-ink"
        >
          {profile.name ? (
            profile.name.slice(0, 1).toUpperCase()
          ) : (
            <User className="size-[18px]! text-accent-ink!" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{profile.name || 'Set your name'}</span>
          <span className="block truncate text-small text-text-3">Your profile</span>
        </span>
      </button>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function SidebarBody() {
  const navigate = useNavigate()
  const profiles = useProfiles()
  const { slug } = useParams({ strict: false })
  const [creating, setCreating] = useState(false)
  const target = profiles.data?.find((p) => p.slug === slug) ?? profiles.data?.[0]

  const newChat = () => {
    if (!target) {
      setCreating(true)
      return
    }
    void navigate({ to: '/t/$slug', params: { slug: target.slug }, search: { thread: 'new' } })
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 pt-3.5 pr-1 pb-3 pl-3">
      <Header />
      <Button variant="primary" className="w-full" disabled={profiles.isPending} onClick={newChat}>
        <SquarePen aria-hidden="true" />
        New chat
      </Button>
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
          className="shrink-0 overflow-hidden"
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
