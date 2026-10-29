import { useNavigate, useSearch } from '@tanstack/react-router'
import { Activity } from 'lucide-react'
import { NeedsYou } from '../approvals/NeedsYou.tsx'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs.tsx'
import { PageShell } from './PageShell.tsx'
import type { ApprovalsTab } from './search.ts'

/**
 * Needs you and Activity (UI-REDESIGN.md §5). The tab lives in `?tab=`.
 * reason: Activity stays empty until the activity feed (D2.12) exists.
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
          <NeedsYou />
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
