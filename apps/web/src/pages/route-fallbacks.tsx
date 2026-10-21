import type { ErrorComponentProps } from '@tanstack/react-router'
import { Button } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'

/** Shown while a split-off page's code loads: the page frame with quiet placeholder bars. */
export function RoutePending() {
  return (
    <div
      role="status"
      aria-label="Loading"
      aria-busy="true"
      className="flex flex-col gap-3 px-6 py-8 md:px-10"
    >
      <span className="h-7 w-40 animate-pulse rounded-sm bg-surface-2" />
      <span className="h-4 w-64 max-w-full animate-pulse rounded-xs bg-surface-2" />
      <span className="mt-4 h-40 w-full max-w-[860px] animate-pulse rounded-card bg-surface-2" />
    </div>
  )
}

/**
 * A page that failed to load or render, usually because its code chunk could not be fetched (the
 * server restarted with a new build, or the connection dropped).
 */
export function RouteError({ reset }: Pick<ErrorComponentProps, 'error' | 'reset'>) {
  return (
    <EmptyState
      title="This page didn't load"
      headingLevel={1}
      mascot="error"
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    >
      Check that the Mawl server is running. If it was just updated, reload the app.
    </EmptyState>
  )
}
