import { Link } from '@tanstack/react-router'
import { CalendarClock } from 'lucide-react'
import { buttonClass } from '../ui/Button.tsx'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { PageShell } from './PageShell.tsx'

/**
 * The code calls this `routines`; the UI says Scheduled.
 * reason: the timetable is empty until scheduled runs exist (D5.5).
 */
export function ScheduledPage() {
  return (
    <PageShell
      title="Scheduled"
      description="Things your teammates do on their own, on a timetable."
    >
      <EmptyPanel
        icon={CalendarClock}
        title="Nothing scheduled yet"
        action={
          <Link to="/t" className={buttonClass('soft')}>
            Open a chat
          </Link>
        }
      >
        Ask a teammate to do something every morning and it will show up here.
      </EmptyPanel>
    </PageShell>
  )
}
