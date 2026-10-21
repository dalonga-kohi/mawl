import { Link } from '@tanstack/react-router'
import { buttonClass } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { PageShell } from './PageShell.tsx'

/*
 * Views whose data arrives in later slices (P2.4 approvals, P2.6 activity, P3.7 memory, P5.2
 * routines, P2.5 connections). Each one is honest about being empty and says what will show up.
 */

export const ActivityPage = () => (
  <PageShell title="Activity" description="Everything your teammates do, in plain sentences.">
    <EmptyState title="Nothing yet" mascot="sleepy">
      Activity shows up here once a teammate starts working.
    </EmptyState>
  </PageShell>
)

export const ApprovalsPage = () => (
  <PageShell
    title="Approvals"
    description="Things your teammates won't do without you. Sends, deletes and purchases always wait here."
  >
    <EmptyState title="All clear" mascot="done">
      When a teammate needs your OK, the request waits here and on your phone.
    </EmptyState>
  </PageShell>
)

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

// U5 fills this page with Connections, Skills and Plugins tabs.
export const ToolsPage = () => (
  <PageShell title="Tools" description="What your teammates can reach and use.">
    <EmptyState
      title="Tools are on their way"
      mascot="working"
      action={
        <Link to="/connections" className={buttonClass('soft')}>
          Open connections
        </Link>
      }
    >
      Connections, skills and plugins live here soon.
    </EmptyState>
  </PageShell>
)

export const RoutinesPage = () => (
  <PageShell title="Scheduled" description="Work that happens on its own, on a schedule you set.">
    <EmptyState title="Nothing scheduled yet" mascot="idle">
      A scheduled task repeats on its own, like a morning inbox sweep with a summary to your phone.
    </EmptyState>
  </PageShell>
)

export const ConnectionsPage = () => (
  <PageShell title="Connections" description="Apps and services your teammates can use for you.">
    <EmptyState title="No connections yet" mascot="idle">
      Connect an app to let teammates read your calendar, file issues or post updates.
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
