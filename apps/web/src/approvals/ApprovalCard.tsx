import type { Approval, ApprovalStatus } from '@mawl/contracts'
import { Link } from '@tanstack/react-router'
import { Ban, Check, CircleAlert, Clock, X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { conflictStatus } from '../api/approvals-api.ts'
import { toolLabel } from '../chat/ToolActivityCard.tsx'
import { when } from '../chat/when.ts'
import { transitions } from '../motion/presets.ts'
import { Badge } from '../ui/Badge.tsx'
import { Button, buttonClass } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { ACTION_LABEL, argsText, expiryLabel, STATUS_LABEL } from './format.ts'
import { useDecideApproval } from './queries.ts'

const STATUS_BADGE = {
  approved: { variant: 'ok', icon: Check },
  denied: { variant: 'danger', icon: X },
  expired: { variant: 'warn', icon: Clock },
  cancelled: { variant: 'neutral', icon: Ban },
} as const

/** Re-renders every `ms` while `active`, so a countdown stays true without a refetch. */
function useNow(active: boolean, ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [active, ms])
  return now
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One parked tool call: who asked, what for, why Mawl stopped, the redacted arguments and the
 * decision. Used in the inbox and, with `inline`, in the chat thread. A decision, or a CONFLICT
 * that reports the true status, shows its result at once; the refetch the decision triggers then
 * confirms it. Never an error toast for a conflict: the status is the answer.
 */
export function ApprovalCard({
  approval,
  teammate,
  inline = false,
}: {
  approval: Approval
  /** The teammate's name; a plain fallback when the profile is not known. */
  teammate: string | undefined
  /** In the chat thread: adds a link to the inbox. */
  inline?: boolean
}) {
  const decide = useDecideApproval()
  const settled: ApprovalStatus =
    decide.data?.status ?? conflictStatus(decide.error) ?? approval.status
  const pending = settled === 'pending'
  const now = useNow(pending)
  const title = capital(toolLabel(approval.tool))
  const name = teammate ?? 'A teammate'
  const busy = decide.isPending
  const failed = decide.isError && conflictStatus(decide.error) === undefined
  const act = (decision: 'approve' | 'deny') => decide.mutate({ id: approval.id, decision })

  return (
    <article
      aria-label={`${title} for ${name}`}
      className={cx(
        'flex flex-col gap-3 rounded-card bg-surface p-4 shadow-[0_0_0_1px_var(--line)]',
        inline && 'max-w-[68ch]',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-col">
          <h3 className="truncate font-semibold text-body">{title}</h3>
          <p className="flex flex-wrap items-center gap-x-2 text-small text-text-2">
            <span>{name}</span>
            <span aria-hidden="true">·</span>
            <span>{ACTION_LABEL[approval.actionClass]}</span>
          </p>
        </div>
        {pending ? null : <StatusBadge status={settled} />}
      </header>
      <p className="text-small text-text-2">{approval.reason}</p>
      <section aria-label="Arguments">
        <pre className="max-h-40 overflow-auto rounded-sm bg-surface-2 px-3 py-2 font-mono text-micro whitespace-pre-wrap">
          {argsText(approval.argsRedacted)}
        </pre>
      </section>
      {pending ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button variant="primary" disabled={busy} onClick={() => act('approve')}>
              Approve
            </Button>
            <Button disabled={busy} onClick={() => act('deny')}>
              Deny
            </Button>
            <span className="text-small text-text-2 sm:ml-auto">
              {expiryLabel(approval.expiresAt, now)}
            </span>
          </div>
          {failed ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-sm bg-danger-soft px-3 py-2 text-small text-danger"
            >
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Mawl couldn't save your decision. Check that the server is running, then try again.
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-small text-text-2">
          {when(decide.data?.decidedAt ?? approval.decidedAt ?? approval.createdAt)}
        </p>
      )}
      {inline ? (
        <Link to="/approvals" className={cx(buttonClass('ghost', 'sm'), 'self-start')}>
          Open all approvals
        </Link>
      ) : null}
    </article>
  )
}

function StatusBadge({ status }: { status: Exclude<ApprovalStatus, 'pending'> }) {
  const { variant, icon: Icon } = STATUS_BADGE[status]
  return (
    <motion.span
      key={status}
      initial={{ scale: 0.8, opacity: 0 }}
      animate={{ scale: 1, opacity: 1, transition: transitions.bouncy }}
    >
      <Badge variant={variant}>
        <Icon aria-hidden="true" />
        {STATUS_LABEL[status]}
      </Badge>
    </motion.span>
  )
}
