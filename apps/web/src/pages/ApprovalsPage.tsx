import { useNavigate, useSearch } from '@tanstack/react-router'
import { Activity, CircleCheck } from 'lucide-react'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs.tsx'
import { PageShell } from './PageShell.tsx'
import type { ApprovalsTab } from './search.ts'

/**
 * Needs you and Activity (UI-REDESIGN.md §5). The tab lives in `?tab=`.
 * reason: both lists stay empty until the approval queue (D2.4) and the activity feed (D2.12)
 * exist; the sidebar count waits for D2.4 too.
 */
export function ApprovalsPage() {
  const { tab } = useSearch({ from: '/approvals' })
  const navigate = useNavigate({ from: '/approvals' })
  return (
    <PageShell title="Approvals" description="Decisions your teammates are waiting on.">
      <Tabs
        value={tab}
        onValueChange={(next) => navigate({ search: { tab: next as ApprovalsTab }, replace: true })}
        className="gap-6"
      >
        <TabsList aria-label="Approvals" className="w-full md:w-fit">
          <TabsTrigger value="needs-you" className="md:min-w-28">
            Needs you
          </TabsTrigger>
          <TabsTrigger value="activity" className="md:min-w-28">
            Activity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="needs-you">
          <EmptyPanel icon={CircleCheck} title="You're all caught up">
            When a teammate needs your OK, it appears here.
          </EmptyPanel>
        </TabsContent>
        <TabsContent value="activity">
          <EmptyPanel icon={Activity} title="No activity yet">
            What your teammates do shows up here, in plain sentences.
          </EmptyPanel>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
