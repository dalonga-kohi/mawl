import type { Approval } from '@mawl/contracts'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { useProfiles } from '../teammates/queries.ts'
import { Button } from '../ui/Button.tsx'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { ApprovalCard } from './ApprovalCard.tsx'
import { usePendingApprovals, useRecentApprovals } from './queries.ts'

/** The inbox: what waits on the owner first, then what was decided lately. */
export function NeedsYou() {
  const pending = usePendingApprovals()
  const recent = useRecentApprovals()
  const profiles = useProfiles()
  const nameOf = (a: Approval) => profiles.data?.find((p) => p.id === a.profileId)?.name

  if (pending.isPending || recent.isPending) return <InboxSkeleton />
  if (pending.isError || recent.isError) {
    return (
      <EmptyPanel
        icon={CircleAlert}
        title="Can't load approvals"
        action={
          <Button
            onClick={() => {
              void pending.refetch()
              void recent.refetch()
            }}
          >
            Try again
          </Button>
        }
      >
        The Mawl server didn't send them. Check that it's running, then try again.
      </EmptyPanel>
    )
  }

  const resolved = recent.data.filter((a) => a.status !== 'pending')
  return (
    <div className="flex flex-col gap-8">
      {pending.data.length === 0 ? (
        <EmptyPanel icon={CircleCheck} title="You're all caught up">
          When a teammate needs your OK, it appears here.
        </EmptyPanel>
      ) : (
        <Group label="Waiting for you" items={pending.data} nameOf={nameOf} />
      )}
      {resolved.length > 0 ? <Group label="Recent" items={resolved} nameOf={nameOf} /> : null}
    </div>
  )
}

function Group({
  label,
  items,
  nameOf,
}: {
  label: string
  items: Approval[]
  nameOf: (a: Approval) => string | undefined
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3">
      <h2 className="text-heading">{label}</h2>
      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((a) => (
          <li key={a.id} className="flex flex-col [&>article]:flex-1">
            <ApprovalCard approval={a} teammate={nameOf(a)} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function InboxSkeleton() {
  return (
    <div role="status" aria-label="Loading approvals" className="grid gap-3 md:grid-cols-2">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-card bg-surface p-4 shadow-[0_0_0_1px_var(--line)]"
        >
          <span className="h-4 w-1/3 animate-pulse rounded-xs bg-surface-2" />
          <span className="h-3 w-4/5 animate-pulse rounded-xs bg-surface-2" />
          <span className="h-16 animate-pulse rounded-sm bg-surface-2" />
          <span className="h-10 w-40 animate-pulse rounded-md bg-surface-2" />
        </div>
      ))}
    </div>
  )
}
