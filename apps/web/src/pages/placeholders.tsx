import { Link } from '@tanstack/react-router'
import { buttonClass } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { PageShell } from './PageShell.tsx'

/*
 * Views whose data arrives in a later slice (D3.7 memory). Honest about being empty and says what
 * will show up. Tools, Scheduled and Approvals have their own files.
 */

export const MemoryPage = () => (
  <PageShell
    title="Memory"
    description="What your teammates remember about you and their work. Your edits always win."
  >
    <EmptyState title="Nothing remembered yet" mascot="thinking">
      Teammates keep notes as they work. You can read and edit every one of them here.
    </EmptyState>
  </PageShell>
)

export const NotFoundPage = () => (
  <EmptyState
    title="Nothing lives here"
    headingLevel={1}
    mascot="oops"
    action={
      <Link to="/t" className={buttonClass('primary')}>
        Go to Teammates
      </Link>
    }
  >
    This address doesn't match a page in Mawl.
  </EmptyState>
)
