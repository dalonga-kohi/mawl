import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { Monitor } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCredentials } from '../settings/models/queries.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { ShowSidebarButton } from '../shell/ShowSidebarButton.tsx'
import { Button, buttonClass, IconButton } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { ContextPanelBody } from './ContextPanel.tsx'
import { NewTeammateDialog } from './NewTeammateDialog.tsx'
import { useProfiles } from './queries.ts'
import { SidePanel } from './SidePanel.tsx'

/** Shows or hides the context panel; the label says which. */
export function PanelToggle() {
  const { panelOpen, setPanelOpen } = useShell()
  return (
    <IconButton
      label={panelOpen ? 'Hide computer panel' : 'Show computer panel'}
      onClick={() => setPanelOpen(!panelOpen)}
      aria-expanded={panelOpen}
    >
      <Monitor aria-hidden="true" />
    </IconButton>
  )
}

/** Whatever the child route shows (a conversation, or the landing state); the sidebar lists teammates. */

export function TeammatesLayout() {
  // Fetch the conversation chunk while the list renders, so opening a teammate never shows a
  // blank frame.
  useEffect(() => {
    void import('../chat/ChatView.tsx')
  }, [])
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <Outlet />
    </div>
  )
}

function FirstRun() {
  const credentials = useCredentials()
  const [creating, setCreating] = useState(false)
  if (credentials.isPending) return <div className="flex-1" />
  const hasModel = (credentials.data ?? []).some((c) => !c.reauthRequired)
  return hasModel ? (
    <>
      <EmptyState
        title="Meet your first teammate"
        mascot="listening"
        mascotSize={120}
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            Create a teammate
          </Button>
        }
      >
        Give it a name and a job in one sentence. It keeps working on the server, even when this
        window is closed.
      </EmptyState>
      <NewTeammateDialog open={creating} onOpenChange={setCreating} />
    </>
  ) : (
    <EmptyState
      title="No teammates yet"
      mascot="idle"
      mascotSize={120}
      action={
        <Link to="/settings" search={{ section: 'models' }} className={buttonClass('primary')}>
          Connect a model
        </Link>
      }
    >
      Connect a model first. Then create a teammate and give it a job in one sentence.
    </EmptyState>
  )
}

/** `/t`: opens the first teammate, or explains how to get one. */
export function TeammatesIndex() {
  const profiles = useProfiles()
  const first = profiles.data?.[0]
  if (first) return <Navigate to="/t/$slug" params={{ slug: first.slug }} replace />
  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-[68px] items-center gap-3 px-3 py-3 md:px-5">
          <ShowSidebarButton />
          <span className="flex-1" />
          <PanelToggle />
        </header>
        {profiles.isPending ? (
          <div className="flex-1" />
        ) : profiles.isError ? (
          <EmptyState
            title="Can't reach your teammates"
            mascot="oops"
            action={<Button onClick={() => void profiles.refetch()}>Try again</Button>}
          >
            The Mawl server didn't answer. Check that it's running, then try again.
          </EmptyState>
        ) : (
          <FirstRun />
        )}
      </section>
      <SidePanel>
        <ContextPanelBody />
      </SidePanel>
    </>
  )
}
