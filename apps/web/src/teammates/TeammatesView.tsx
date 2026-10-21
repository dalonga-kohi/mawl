import { Link, Navigate, Outlet } from '@tanstack/react-router'
import { PanelRight, PanelRightClose } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCredentials } from '../settings/models/queries.ts'
import { useShell } from '../shell/ShellContext.tsx'
import { MEDIUM, useMediaQuery } from '../shell/use-media-query.ts'
import { Button, buttonClass, IconButton } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { ContextPanelBody } from './ContextPanel.tsx'
import { NewTeammateDialog } from './NewTeammateDialog.tsx'
import { useProfiles } from './queries.ts'
import { SidePanel } from './SidePanel.tsx'
import { TeammateList } from './TeammateList.tsx'

/** Shows or hides the context panel; the label says which. */
export function PanelToggle() {
  const { panelOpen, setPanelOpen } = useShell()
  return (
    <IconButton
      label={panelOpen ? 'Hide side panel' : 'Show side panel'}
      onClick={() => setPanelOpen(!panelOpen)}
      aria-expanded={panelOpen}
    >
      {panelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRight aria-hidden="true" />}
    </IconButton>
  )
}

/**
 * Teammate list beside whatever the child route shows (a conversation, or the landing state).
 * Below 760 px the list steps aside; the landing route shows it full screen instead.
 */
export function TeammatesLayout() {
  // Fetch the conversation chunk while the list renders, so opening a teammate never shows a
  // blank frame.
  useEffect(() => {
    void import('../chat/ChatView.tsx')
  }, [])
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] md:grid-cols-[280px_minmax(0,1fr)]">
      <TeammateList />
      <div className="flex min-h-0 min-w-0">
        <Outlet />
      </div>
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
        <Link to="/settings" hash="models" className={buttonClass('primary')}>
          Connect a model
        </Link>
      }
    >
      Connect a model first. Then create a teammate and give it a job in one sentence.
    </EmptyState>
  )
}

/** `/t`: opens the first teammate, or explains how to get one. Phones see the list itself. */
export function TeammatesIndex() {
  const medium = useMediaQuery(MEDIUM)
  const profiles = useProfiles()
  const first = profiles.data?.[0]
  if (first && medium) {
    return <Navigate to="/t/$slug" params={{ slug: first.slug }} replace />
  }
  if (first) return <TeammateList variant="screen" />
  return (
    <>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
        <header className="flex min-h-[68px] items-center justify-end gap-3 border-b border-line px-5 py-3.5">
          {/* Below 760 px the list is hidden, so the conversation carries the view's title. */}
          {medium ? null : <h1 className="flex-1 text-heading">Teammates</h1>}
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
