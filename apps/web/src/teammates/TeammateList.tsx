import { type Profile, parseModelRef } from '@faire/contracts'
import { Link } from '@tanstack/react-router'
import { Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { paletteShortcutLabel } from '../shell/CommandPalette.tsx'
import { useShell } from '../shell/ShellContext.tsx'
import { Button, IconButton } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { NewTeammateDialog } from './NewTeammateDialog.tsx'
import { useProfiles } from './queries.ts'
import { TeammateAvatar } from './TeammateAvatar.tsx'

function Row({ profile }: { profile: Profile }) {
  const model = parseModelRef(profile.modelMain)?.modelId
  return (
    <li>
      <Link
        to="/t/$slug"
        params={{ slug: profile.slug }}
        className={cx(
          'flex min-h-14 items-center gap-3 rounded-md px-2.5 py-2 transition-colors duration-[120ms]',
          'hover:bg-surface active:scale-[.98]',
          'aria-[current=page]:bg-surface aria-[current=page]:shadow-1',
        )}
      >
        <TeammateAvatar color={profile.color} size={40} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{profile.name}</span>
          {model ? <span className="block truncate text-small text-text-2">{model}</span> : null}
        </span>
      </Link>
    </li>
  )
}

function Skeleton() {
  return (
    <ul aria-hidden="true" className="flex flex-col gap-1 px-2">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-2.5 py-2">
          <span className="size-10 animate-pulse rounded-sm bg-line" />
          <span className="flex flex-1 flex-col gap-1.5">
            <span className="h-3 w-2/3 animate-pulse rounded-xs bg-line" />
            <span className="h-2.5 w-1/3 animate-pulse rounded-xs bg-line" />
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Teammates beside the conversation (280 px column), or the whole screen on phones, where the
 * list is the landing view and a teammate opens full screen.
 */
export function TeammateList({ variant = 'column' }: { variant?: 'column' | 'screen' }) {
  const { setPaletteOpen } = useShell()
  const profiles = useProfiles()
  const [creating, setCreating] = useState(false)
  const Heading = variant === 'screen' ? 'h1' : 'h2'
  return (
    <aside
      aria-label="Teammates"
      className={cx(
        'min-h-0 min-w-0 flex-col bg-surface-2',
        variant === 'column' ? 'hidden border-r border-line md:flex' : 'flex flex-1',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-[18px] pb-2.5">
        <Heading className="text-heading">Teammates</Heading>
        <IconButton label="New teammate" onClick={() => setCreating(true)}>
          <Plus aria-hidden="true" />
        </IconButton>
      </div>
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="mx-3 mb-2.5 flex h-[38px] pointer-coarse:h-11 items-center gap-2 rounded-sm bg-surface px-2.5 text-left text-small text-text-2 transition-colors duration-[120ms] hover:text-text"
      >
        <Search className="size-[18px]" aria-hidden="true" />
        <span className="flex-1">Search or jump to…</span>
        <kbd className="rounded-xs bg-surface-2 px-1.5 font-ui text-micro text-text-2">
          {paletteShortcutLabel()}
        </kbd>
      </button>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {profiles.isPending ? (
          <Skeleton />
        ) : profiles.isError ? (
          <div className="flex flex-col items-start gap-2 px-4 py-3">
            <p role="alert" className="text-small text-text-2">
              Couldn't load your teammates.
            </p>
            <Button size="sm" onClick={() => void profiles.refetch()}>
              Try again
            </Button>
          </div>
        ) : profiles.data.length === 0 ? (
          <p className="px-4 py-3 text-small text-text-2">Your teammates will be listed here.</p>
        ) : (
          <ul className="flex flex-col gap-0.5 px-2">
            {profiles.data.map((p) => (
              <Row key={p.id} profile={p} />
            ))}
          </ul>
        )}
      </div>
      <NewTeammateDialog open={creating} onOpenChange={setCreating} />
    </aside>
  )
}
