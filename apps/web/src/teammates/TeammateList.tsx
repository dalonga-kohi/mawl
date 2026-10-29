import type { Profile } from '@mawl/contracts'
import { Link, useParams } from '@tanstack/react-router'
import { Ellipsis, Pin, PinOff, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { KeyboardEvent } from 'react'
import { when } from '../chat/when.ts'
import { MawlAvatar } from '../mascot/MawlAvatar.tsx'
import { transitions } from '../motion/presets.ts'
import { ActiveIndicator } from '../shell/ActiveIndicator.tsx'
import { useShell } from '../shell/ShellContext.tsx'
import { Button } from '../ui/Button.tsx'
import { cn } from '../ui/cn.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.tsx'
import { usePinned } from './pins.ts'
import { useProfiles, useThreads } from './queries.ts'
import { TeammateAvatar } from './TeammateAvatar.tsx'

/** Rows enter, leave and reorder (pinning) on the glide spring; reduced motion makes it instant. */
const rowMotion = {
  layout: 'position' as const,
  initial: { opacity: 0, y: -4 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, transition: transitions.exit },
  transition: transitions.glide,
}

function Row({
  profile,
  pinned,
  open,
  onTogglePin,
}: {
  profile: Profile
  pinned: boolean
  /** This teammate's conversation is the one on screen. */
  open: boolean
  onTogglePin: () => void
}) {
  const { mascot } = useShell()
  const latest = useThreads(profile.id).data?.[0]
  // Only the open teammate has run data to read; other rows get a dot once the API reports runs.
  const live = open && (mascot === 'thinking' || mascot === 'working')
  const line = live ? 'Working…' : latest ? (latest.title ?? 'Untitled chat') : 'No messages yet'
  const stamp = latest ? when(latest.lastEventAt ?? latest.createdAt) : ''
  return (
    <motion.li className="group relative" {...rowMotion}>
      <Link
        to="/t/$slug"
        params={{ slug: profile.slug }}
        data-teammate-row=""
        className={cn(
          'tween relative isolate flex min-h-15 items-center gap-3 rounded-md py-2 pr-2.5 pl-2',
          'hover:bg-hover active:scale-[.98]',
        )}
      >
        {open ? <ActiveIndicator /> : null}
        <span className="relative shrink-0">
          <TeammateAvatar color={profile.color} size={40} state={open ? mascot : 'idle'} />
          {live ? (
            <span
              className="live-dot absolute right-0 bottom-0 shadow-[0_0_0_2px_var(--bg)]"
              role="img"
              aria-label="Working now"
            />
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-body font-semibold text-text">
              {profile.name}
            </span>
            {pinned ? (
              <span role="img" aria-label="Pinned" className="text-text-3">
                <Pin className="size-3" aria-hidden="true" />
              </span>
            ) : null}
            <span className="shrink-0 text-micro text-text-3 tabular-nums">{stamp}</span>
          </span>
          <span
            className={cn(
              'block truncate pr-7 text-small',
              live ? 'text-secondary-ink' : 'text-text-2',
            )}
          >
            {line}
          </span>
        </span>
        {/* reason: the unread count needs a per-teammate unread number the API does not expose yet. */}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${profile.name}`}
          className={cn(
            'absolute right-1.5 bottom-1.5 grid size-7 place-items-center rounded-sm text-text-2 pointer-coarse:size-11',
            'opacity-0 transition-[opacity,background-color] duration-(--dur-fast) hover:bg-selected group-hover:opacity-100',
            'focus-visible:opacity-100 data-[state=open]:bg-selected data-[state=open]:opacity-100 pointer-coarse:opacity-100',
          )}
        >
          <Ellipsis className="size-[18px]" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" collisionPadding={16}>
          <DropdownMenuItem onSelect={onTogglePin}>
            {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </motion.li>
  )
}

function Skeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-0.5">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex min-h-15 items-center gap-3 py-2 pr-2.5 pl-2">
          <span className="size-10 shrink-0 animate-pulse rounded-full bg-selected" />
          <span className="flex flex-1 flex-col gap-2">
            <span className="h-3 w-1/2 animate-pulse rounded-xs bg-selected" />
            <span className="h-2.5 w-4/5 animate-pulse rounded-xs bg-hover" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The last row of the list: a round plus slot where an orb would be, and the label. */
function NewTeammateRow({ onClick }: { onClick: () => void }) {
  return (
    <motion.li {...rowMotion}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'tween group/new flex min-h-13 w-full items-center gap-3 rounded-md py-1.5 pr-2.5 pl-2 text-left text-body text-text-2',
          'hover:bg-hover hover:text-text active:scale-[.97]',
        )}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-hover text-text-2 transition-colors duration-(--dur-fast) group-hover/new:bg-selected group-hover/new:text-accent-ink">
          <Plus
            className="size-[18px] transition-transform duration-(--dur-base) ease-out group-hover/new:rotate-90"
            aria-hidden="true"
          />
        </span>
        New teammate
      </button>
    </motion.li>
  )
}

const ROVING_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End']

/** Up/Down move between teammate rows, Home and End jump to the ends; Enter opens (a link). */
function rovingKeys(e: KeyboardEvent<HTMLUListElement>) {
  if (!ROVING_KEYS.includes(e.key)) return
  const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-teammate-row]')]
  if (rows.length === 0) return
  const here = (e.target as HTMLElement)
    .closest('li')
    ?.querySelector<HTMLElement>('[data-teammate-row]')
  const i = here ? rows.indexOf(here) : -1
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? rows.length - 1
        : e.key === 'ArrowDown'
          ? Math.min(rows.length - 1, i + 1)
          : Math.max(0, i - 1)
  e.preventDefault()
  rows[next]?.focus()
}

/**
 * The teammates, listed like chats: pinned ones first (with a pin mark), then the rest, one row
 * per teammate with its orb, name, the latest conversation (or what it is doing) and its time; a
 * New teammate row closes the list. Loading shows skeleton rows, an empty list invites the first
 * teammate, and a failed load says so with Retry.
 */
export function TeammateList({ onNewTeammate }: { onNewTeammate: () => void }) {
  const profiles = useProfiles()
  const { pinned, toggle } = usePinned()
  const { slug } = useParams({ strict: false })
  const all = profiles.data ?? []
  const pinnedProfiles = pinned
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Profile => p !== undefined)
  const ordered = [...pinnedProfiles, ...all.filter((p) => !pinned.includes(p.id))]

  return (
    <section
      aria-label="Teammates"
      aria-busy={profiles.isPending}
      className="mt-2 flex min-h-0 flex-1 flex-col"
    >
      <h2 className="px-3 pb-1 text-small text-text-3">Teammates</h2>
      <motion.div
        layoutScroll
        className="-mx-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
      >
        {profiles.isPending ? (
          <Skeleton />
        ) : profiles.isError ? (
          <div className="flex flex-col items-start gap-2 px-3 py-2">
            <p role="alert" className="text-small text-text-2">
              Couldn't load your teammates. Check that the Mawl server is running.
            </p>
            <Button size="sm" onClick={() => void profiles.refetch()}>
              Retry
            </Button>
          </div>
        ) : all.length === 0 ? (
          <motion.div
            className="flex flex-col items-start gap-1.5 px-3 py-3"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: transitions.fade }}
          >
            <MawlAvatar size={40} className="mb-1" />
            <p className="text-body font-semibold text-text">No teammates yet</p>
            <p className="text-small text-text-2">
              Give one a job and it shows up here, like a chat.
            </p>
            <Button variant="primary" size="sm" className="mt-2" onClick={onNewTeammate}>
              <Plus aria-hidden="true" />
              New teammate
            </Button>
          </motion.div>
        ) : (
          <ul className="flex flex-col gap-0.5" onKeyDown={rovingKeys}>
            <AnimatePresence initial={false}>
              {ordered.map((p) => (
                <Row
                  key={p.id}
                  profile={p}
                  pinned={pinned.includes(p.id)}
                  open={p.slug === slug}
                  onTogglePin={() => toggle(p.id)}
                />
              ))}
              <NewTeammateRow key="new-teammate" onClick={onNewTeammate} />
            </AnimatePresence>
          </ul>
        )}
      </motion.div>
    </section>
  )
}
