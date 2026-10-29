import type { Profile } from '@mawl/contracts'
import { Link, useParams } from '@tanstack/react-router'
import { Ellipsis, Pin, PinOff, Plus } from 'lucide-react'
import { when } from '../chat/when.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { Button, IconButton } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.tsx'
import { usePinned } from './pins.ts'
import { useProfiles, useThreads } from './queries.ts'
import { TeammateAvatar } from './TeammateAvatar.tsx'

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
  const preview = latest ? (latest.title ?? 'Untitled chat') : 'No messages yet'
  const stamp = latest ? when(latest.lastEventAt ?? latest.createdAt) : ''
  // Only the open teammate has run data to read; other rows get a dot once the API reports runs.
  const live = open && (mascot === 'thinking' || mascot === 'working')
  return (
    <li className="group relative">
      <Link
        to="/t/$slug"
        params={{ slug: profile.slug }}
        className={cx(
          'tween flex min-h-[60px] items-center gap-3 rounded-md px-2.5 py-2',
          'hover:bg-surface-2/70 active:scale-[.98] aria-[current=page]:bg-surface-2',
        )}
      >
        <TeammateAvatar color={profile.color} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-heading">{profile.name}</span>
          <span className="block truncate pr-7 text-small text-text-2">{preview}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 self-start pt-0.5">
          {live ? <span className="live-dot" role="img" aria-label="Working now" /> : null}
          <span className="text-micro text-text-3 tabular-nums">{stamp}</span>
        </span>
        {/* reason: the unread pill needs a per-teammate unread count the API does not expose yet. */}
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${profile.name}`}
          className={cx(
            'absolute right-2 bottom-2 grid size-7 place-items-center rounded-sm text-text-2 pointer-coarse:size-11',
            'opacity-0 transition-opacity duration-(--dur-fast) hover:bg-line group-hover:opacity-100',
            'focus-visible:opacity-100 data-[state=open]:bg-line data-[state=open]:opacity-100 pointer-coarse:opacity-100',
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
    </li>
  )
}

function Skeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex min-h-[60px] items-center gap-3 px-2.5 py-2">
          <span className="size-9 animate-pulse rounded-full bg-surface-2" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3 w-2/3 animate-pulse rounded-xs bg-surface-2" />
            <span className="h-2.5 w-1/2 animate-pulse rounded-xs bg-surface-2" />
          </span>
        </li>
      ))}
    </ul>
  )
}

const headingClass = 'px-2.5 text-small text-text-3'

/**
 * The sidebar's teammate groups: Pinned (only when something is pinned), then Teammates, one row
 * per teammate with a tinted mini Mawl, the latest conversation and its time.
 */
export function TeammateList({ onNewTeammate }: { onNewTeammate: () => void }) {
  const profiles = useProfiles()
  const { pinned, toggle } = usePinned()
  const { slug } = useParams({ strict: false })
  const all = profiles.data ?? []
  const pinnedProfiles = pinned
    .map((id) => all.find((p) => p.id === id))
    .filter((p): p is Profile => p !== undefined)
  const rest = all.filter((p) => !pinned.includes(p.id))
  const rows = (list: Profile[]) =>
    list.map((p) => (
      <Row
        key={p.id}
        profile={p}
        pinned={pinned.includes(p.id)}
        open={p.slug === slug}
        onTogglePin={() => toggle(p.id)}
      />
    ))

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-2">
      {pinnedProfiles.length > 0 ? (
        <section aria-label="Pinned" className="flex flex-col gap-1">
          <h2 className={headingClass}>Pinned</h2>
          <ul className="flex flex-col gap-0.5">{rows(pinnedProfiles)}</ul>
        </section>
      ) : null}
      <section aria-label="Teammates" className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <h2 className={headingClass}>Teammates</h2>
          <IconButton
            label="New teammate"
            tooltipSide="right"
            className="size-7 pointer-coarse:size-11"
            onClick={onNewTeammate}
          >
            <Plus className="size-4" aria-hidden="true" />
          </IconButton>
        </div>
        {profiles.isPending ? (
          <Skeleton />
        ) : profiles.isError ? (
          <div className="flex flex-col items-start gap-2 px-2.5 py-2">
            <p role="alert" className="text-small text-text-2">
              Couldn't load your teammates. Check that the Mawl server is running.
            </p>
            <Button size="sm" onClick={() => void profiles.refetch()}>
              Retry
            </Button>
          </div>
        ) : all.length === 0 ? (
          <div className="flex flex-col items-start gap-2 px-2.5 py-2">
            <p className="text-small text-text-2">Your teammates will be listed here.</p>
            <Button size="sm" onClick={onNewTeammate}>
              Add a teammate
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">{rows(rest)}</ul>
        )}
      </section>
    </div>
  )
}
