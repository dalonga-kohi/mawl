import { durSeconds } from '@mawl/ui'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronDown, PanelLeftClose, Search, SlidersHorizontal, User } from 'lucide-react'
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  type TargetAndTransition,
  useMotionValue,
  useReducedMotionConfig,
  useTransform,
} from 'motion/react'
import { Dialog } from 'radix-ui'
import { type ReactNode, useEffect, useState } from 'react'
import { usePendingApprovals } from '../approvals/queries.ts'
import { overlayFade, transitions } from '../motion/presets.ts'
import { ProfileDialog } from '../profile/ProfileDialog.tsx'
import { useProfile } from '../profile/useProfile.ts'
import { NewTeammateDialog } from '../teammates/NewTeammateDialog.tsx'
import { TeammateList } from '../teammates/TeammateList.tsx'
import { buttonVariants } from '../ui/Button.tsx'
import { cn } from '../ui/cn.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.tsx'
import { Tooltip } from '../ui/Tooltip.tsx'
import { ActiveIndicator } from './ActiveIndicator.tsx'
import { paletteShortcutLabel } from './CommandPalette.tsx'
import { MAIN_NAV, type NavItem } from './nav.ts'
import { useShell } from './ShellContext.tsx'
import { sidebarShortcutLabel } from './shortcuts.ts'

export const SIDEBAR_WIDTH = 280

/**
 * A sidebar row: a soft rounded rectangle (--r-md) with no border. Hover fades in the --hover wash
 * within 100 ms, a press scales to .97 on pointer-down, and the current row wears the sliding
 * active indicator. `isolate` keeps the indicator (z -1) above the row's own hover fill.
 */
export const sidebarRowClass = cn(
  'tween group/row relative isolate flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-body text-text pointer-coarse:h-11',
  'hover:bg-hover active:scale-[.97]',
  '[&>svg]:size-[18px] [&>svg]:shrink-0 [&>svg]:text-text-2 [&>svg]:transition-[translate,rotate,scale,color] [&>svg]:duration-(--dur-base) [&>svg]:ease-out',
  'aria-[current=page]:[&>svg]:text-accent-ink',
)

/** Each row's icon answers a hover with its own small gesture; reduced motion makes it instant. */
const ICON_NUDGE: Partial<Record<NavItem['to'], string>> = {
  '/tools': 'group-hover/row:[&>svg]:-rotate-12',
  '/routines': 'group-hover/row:[&>svg]:rotate-6',
  '/approvals': 'group-hover/row:[&>svg]:scale-110',
}

/** The pending-approvals count. Pops in on the bouncy spring and caps at 99+. */
export function ApprovalsBadge({ count }: { count: number }) {
  return (
    <AnimatePresence initial={false}>
      {count > 0 ? (
        <motion.span
          key="badge"
          aria-label={`${count} waiting`}
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1, transition: transitions.bouncy }}
          exit={{ scale: 0.4, opacity: 0, transition: transitions.exit }}
          className="grid h-5 min-w-5 place-items-center rounded-sm bg-accent-fill px-1.5 text-micro text-on-accent tabular-nums"
        >
          {count > 99 ? '99+' : count}
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

/** Approvals waiting on the owner. No badge while loading or when the list cannot load. */
function usePendingApprovalCount(): number {
  return usePendingApprovals().data?.length ?? 0
}

function NavLink({ item, trailing }: { item: NavItem; trailing?: ReactNode }) {
  const Icon = item.icon
  return (
    <Link to={item.to} className={cn(sidebarRowClass, ICON_NUDGE[item.to])}>
      {({ isActive }) => (
        <>
          {isActive ? <ActiveIndicator /> : null}
          <Icon aria-hidden="true" />
          <span className="flex-1 truncate">{item.label}</span>
          {trailing}
        </>
      )}
    </Link>
  )
}

/** Top row: Search (opens the palette from this row, with its shortcut) and the hide button. */
function TopRow() {
  const { openPaletteFrom, hideSidebar } = useShell()
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className={cn(sidebarRowClass, 'min-w-0 flex-1 group-hover/row:[&>svg]:scale-110')}
        onClick={(e) => openPaletteFrom(e.currentTarget)}
      >
        <Search aria-hidden="true" />
        <span className="flex-1 truncate">Search</span>
        <kbd className="rounded-xs bg-hover px-1.5 py-0.5 font-ui text-micro text-text-3">
          {paletteShortcutLabel()}
        </kbd>
      </button>
      <Tooltip label={`Hide sidebar (${sidebarShortcutLabel()})`} side="right">
        <button
          type="button"
          aria-label="Hide sidebar"
          onClick={hideSidebar}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'icon' }),
            'size-10 text-text-3 [&>svg]:transition-transform [&>svg]:duration-(--dur-base) hover:[&>svg]:-translate-x-0.5 pointer-coarse:size-11',
          )}
        >
          <PanelLeftClose aria-hidden="true" />
        </button>
      </Tooltip>
    </div>
  )
}

/**
 * The owner, like a chat app's account row: a round initial, the name and a chevron that opens
 * the account menu; beside it a sliders button that opens Settings. A hairline sits above.
 */
function Footer() {
  const { profile } = useProfile()
  const { hideSidebar } = useShell()
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const name = profile.name || 'Set your name'
  return (
    <div className="flex items-center gap-1 border-t border-line pt-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              'tween group/acct flex h-12 min-w-0 flex-1 items-center gap-3 rounded-md pr-2.5 pl-1.5 text-left text-text',
              'hover:bg-hover active:scale-[.97] data-[state=open]:bg-selected',
            )}
          >
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-full bg-selected text-body font-semibold text-text"
            >
              {profile.name ? (
                profile.name.slice(0, 1).toUpperCase()
              ) : (
                <User className="size-4 text-text-2" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-body font-semibold">{name}</span>
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-text-3 transition-transform duration-(--dur-base) ease-out group-hover/acct:translate-y-px group-data-[state=open]/acct:rotate-180"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          sideOffset={8}
          className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
        >
          <DropdownMenuItem onSelect={() => setEditing(true)}>
            <User aria-hidden="true" />
            Edit profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void navigate({ to: '/settings' })}>
            <SlidersHorizontal aria-hidden="true" />
            Settings
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={hideSidebar}>
            <PanelLeftClose aria-hidden="true" />
            <span className="flex-1">Hide sidebar</span>
            <kbd className="font-ui text-micro text-text-3">{sidebarShortcutLabel()}</kbd>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip label="Settings" side="top">
        <Link
          to="/settings"
          aria-label="Settings"
          className={cn(
            'tween relative isolate grid size-10 shrink-0 place-items-center rounded-md text-text-2 pointer-coarse:size-11',
            'hover:bg-hover hover:text-text active:scale-[.97] aria-[current=page]:text-accent-ink',
            '[&>svg]:size-[18px] [&>svg]:transition-transform [&>svg]:duration-(--dur-base) [&>svg]:ease-out hover:[&>svg]:rotate-90',
          )}
        >
          {({ isActive }) => (
            <>
              {isActive ? <ActiveIndicator /> : null}
              <SlidersHorizontal aria-hidden="true" />
            </>
          )}
        </Link>
      </Tooltip>
      <ProfileDialog open={editing} onOpenChange={setEditing} />
    </div>
  )
}

function SidebarBody() {
  const [creating, setCreating] = useState(false)
  const approvals = usePendingApprovalCount()
  return (
    <LayoutGroup id="sidebar">
      <div className="flex h-full min-h-0 flex-col gap-1 px-2 pt-3 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <TopRow />
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {MAIN_NAV.map((item) => (
            <NavLink
              key={item.to}
              item={item}
              trailing={item.to === '/approvals' ? <ApprovalsBadge count={approvals} /> : null}
            />
          ))}
        </nav>
        <TeammateList onNewTeammate={() => setCreating(true)} />
        <Footer />
        <NewTeammateDialog open={creating} onOpenChange={setCreating} />
      </div>
    </LayoutGroup>
  )
}

type SidebarMotion = {
  initial: { width: number; opacity: number }
  animate: TargetAndTransition & { width: number }
  exit: TargetAndTransition
}

/**
 * The column opens and closes on the critically damped glide spring, animating its width so the
 * conversation reflows with it while the content slides in from the left edge. Reduced motion keeps
 * the width fixed and only fades.
 */
export function sidebarMotion(reduce: boolean): SidebarMotion {
  if (reduce) {
    return {
      initial: { width: SIDEBAR_WIDTH, opacity: 0 },
      animate: {
        width: SIDEBAR_WIDTH,
        opacity: 1,
        transition: { duration: durSeconds.base, width: { duration: 0 } },
      },
      exit: {
        width: SIDEBAR_WIDTH,
        opacity: 0,
        transition: { duration: durSeconds.base * 0.7, width: { duration: 0 } },
      },
    }
  }
  return {
    initial: { width: 0, opacity: 0 },
    animate: { width: SIDEBAR_WIDTH, opacity: 1, transition: transitions.glide },
    exit: { width: 0, opacity: 0, transition: transitions.glide },
  }
}

/** How far a flick carries (Apple's projection, deceleration 0.998), in px. */
const project = (velocity: number, rate = 0.998) => ((velocity / 1000) * rate) / (1 - rate)
/** Past this projected distance to the left, a swipe closes the drawer. */
const CLOSE_DISTANCE = 100

/**
 * Closes when the swipe is headed far enough left once its momentum is projected forward, so a
 * short flick closes and a slow drag that turns back springs home.
 */
export function shouldCloseDrawer(offsetX: number, velocityX: number): boolean {
  return offsetX + project(velocityX) < -CLOSE_DISTANCE
}

/**
 * Below 760 px the sidebar is a drawer from the left edge over a soft scrim. It tracks a leftward
 * swipe 1:1 and hands the release velocity to the closing spring; reduced motion only fades.
 */
function SidebarDrawer() {
  const { drawerOpen, setDrawerOpen } = useShell()
  const reduce = useReducedMotionConfig() ?? false
  return (
    <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
      <AnimatePresence>
        {drawerOpen ? (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                className="fixed inset-x-0 top-(--titlebar-h) bottom-0 z-40 bg-bg/70 backdrop-blur-[2px]"
                {...overlayFade}
              />
            </Dialog.Overlay>
            <Dialog.Content
              asChild
              aria-describedby={undefined}
              onOpenAutoFocus={(e) => {
                // Focus the drawer itself: landing on the first button would pop its tooltip open.
                e.preventDefault()
                ;(e.currentTarget as HTMLElement | null)?.focus()
              }}
            >
              <motion.div
                className="fixed top-(--titlebar-h) bottom-0 left-0 z-50 w-[min(320px,calc(100vw-40px))] touch-pan-y rounded-r-dialog bg-bg pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] shadow-2 outline-none"
                initial={reduce ? { opacity: 0 } : { x: '-100%' }}
                animate={
                  reduce
                    ? { opacity: 1, transition: transitions.fade }
                    : { x: 0, transition: transitions.glide }
                }
                exit={
                  reduce
                    ? { opacity: 0, transition: transitions.exit }
                    : { x: '-100%', transition: transitions.glide }
                }
                drag={reduce ? false : 'x'}
                dragDirectionLock
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={{ left: 1, right: 0 }}
                dragMomentum={false}
                onDragEnd={(_, info) => {
                  if (shouldCloseDrawer(info.offset.x, info.velocity.x)) setDrawerOpen(false)
                }}
              >
                <Dialog.Title className="sr-only">Sidebar</Dialog.Title>
                <SidebarBody />
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        ) : null}
      </AnimatePresence>
    </Dialog.Root>
  )
}

/**
 * The one navigation surface, read like a chat app: Search, Tools, Scheduled, Approvals, then the
 * teammates as conversations, then the owner. A 280 px column that hides completely, or below
 * 760 px a drawer from the left (UI-REDESIGN.md §5). No icon rail and no bottom tab bar.
 */
export function Sidebar() {
  const { compact, sidebarOpen, setDrawerOpen } = useShell()
  const href = useRouterState({ select: (s) => s.location.href })
  const reduce = useReducedMotionConfig() ?? false
  const width = useMotionValue(SIDEBAR_WIDTH)
  // The content rides the column's edge, so it slides in rather than being wiped into view.
  const x = useTransform(width, (w) => Math.min(0, w - SIDEBAR_WIDTH))

  // Going anywhere closes the drawer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the location is the trigger, not a value read
  useEffect(() => setDrawerOpen(false), [href, setDrawerOpen])

  if (compact) return <SidebarDrawer />
  const m = sidebarMotion(reduce)
  return (
    <AnimatePresence initial={false}>
      {sidebarOpen ? (
        <motion.aside
          key="sidebar"
          aria-label="Sidebar"
          className="shrink-0 overflow-hidden border-r border-line"
          style={{ width }}
          initial={m.initial}
          animate={m.animate}
          exit={m.exit}
        >
          <motion.div className="h-full" style={{ width: SIDEBAR_WIDTH, x }}>
            <SidebarBody />
          </motion.div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
