import type { Thread, ThreadId } from '@faire/contracts'
import { Check, ChevronDown, SquarePen } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { cx } from '../ui/cx.ts'

const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const clock = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

function when(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? clock.format(d) : day.format(d)
}

const item =
  'flex min-h-10 pointer-coarse:min-h-11 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-small outline-none select-none data-[highlighted]:bg-surface-2'

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
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="flex h-8 pointer-coarse:h-11 max-w-full min-w-0 items-center gap-1 rounded-sm px-1.5 -ml-1.5 text-small text-text-2 transition-colors duration-[120ms] hover:bg-surface-2 hover:text-text data-[state=open]:bg-surface-2"
        aria-label={`Conversation: ${title}. Switch conversation`}
      >
        <span className="truncate">{title}</span>
        <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="z-50 flex max-h-[min(420px,var(--radix-dropdown-menu-content-available-height))] w-[min(320px,calc(100vw-32px))] flex-col gap-0.5 overflow-y-auto rounded-md bg-surface p-1.5 shadow-2"
        >
          <DropdownMenu.Item className={cx(item, 'font-semibold')} onSelect={onNew}>
            <SquarePen className="size-[18px] text-text-2" aria-hidden="true" />
            New chat
          </DropdownMenu.Item>
          {threads.length > 0 ? <DropdownMenu.Separator className="my-1 h-px bg-line" /> : null}
          {threads.map((t) => (
            <DropdownMenu.Item key={t.id} className={item} onSelect={() => onPick(t.id)}>
              <span className="grid size-[18px] shrink-0 place-items-center text-accent-ink">
                {t.id === current ? <Check className="size-4" aria-label="Current" /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{t.title ?? 'Untitled chat'}</span>
              <span className="shrink-0 text-micro text-text-2 tabular-nums">
                {when(t.lastEventAt ?? t.createdAt)}
              </span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
