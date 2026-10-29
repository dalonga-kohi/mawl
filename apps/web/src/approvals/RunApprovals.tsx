import type { RunId } from '@mawl/contracts'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { enter } from '../motion/presets.ts'
import { buttonClass } from '../ui/Button.tsx'
import { ApprovalCard } from './ApprovalCard.tsx'
import { useRecentApprovals } from './queries.ts'

/**
 * The approvals of the run the chat follows, shown as cards in the thread while the run is going.
 * Decided ones stay (with their result) until the run ends. If the run waits but its call could not
 * be loaded, a note sends the owner to the inbox instead.
 */
export function RunApprovals({
  runId,
  waiting,
  teammate,
}: {
  runId: RunId
  /** The run is in `waiting_approval`. */
  waiting: boolean
  teammate: string
}) {
  const recent = useRecentApprovals()
  const mine = recent.data?.filter((a) => a.runId === runId) ?? []
  // Waiting but no live card: the call could not be loaded, or a newer one has not arrived yet.
  const needsNote = waiting && !recent.isPending && !mine.some((a) => a.status === 'pending')
  return (
    <>
      {[...mine].reverse().map((a) => (
        <motion.div key={a.id} {...enter}>
          <ApprovalCard approval={a} teammate={teammate} inline />
        </motion.div>
      ))}
      {needsNote ? (
        <motion.div {...enter} className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-small text-text-2">Waiting for your OK. Open approvals to decide.</p>
          <Link to="/approvals" className={buttonClass('soft', 'sm')}>
            Open approvals
          </Link>
        </motion.div>
      ) : null}
    </>
  )
}
