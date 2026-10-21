import type { Thread, ThreadId } from '@mawl/contracts'
import { Check, ChevronDown, SquarePen } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu.tsx'
import { when } from './when.ts'

/** Switches between this teammate's conversations, or starts a new one. */
export function ThreadMenu({
  threads,
  current,
  onPick,
  onNew,
}: {
  threads: Thread[]
  current: ThreadId | undefined
  onPick: (id: ThreadId) => void
  onNew: () => void
}) {
  const title = threads.find((t) => t.id === current)?.title ?? 'New chat'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex h-8 pointer-coarse:h-11 max-w-full min-w-0 items-center gap-1 rounded-pill px-2.5 -ml-2.5 text-small text-text-2 transition-colors duration-[120ms] hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
        aria-label={`Conversation: ${title}. Switch conversation`}
      >
        <span className="truncate">{title}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        collisionPadding={16}
        className="max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-[min(320px,calc(100vw-32px))]"
      >
        <DropdownMenuItem className="font-semibold" onSelect={onNew}>
          <SquarePen className="size-[18px] text-text-2" aria-hidden="true" />
          New chat
        </DropdownMenuItem>
        {threads.length > 0 ? <DropdownMenuSeparator /> : null}
        {threads.map((t) => (
          <DropdownMenuItem key={t.id} onSelect={() => onPick(t.id)}>
            <span className="grid size-[18px] shrink-0 place-items-center text-accent-ink">
              {t.id === current ? (
                <Check className="size-4 text-accent-ink" aria-label="Current" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{t.title ?? 'Untitled chat'}</span>
            <span className="shrink-0 text-micro text-text-2 tabular-nums">
              {when(t.lastEventAt ?? t.createdAt)}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
