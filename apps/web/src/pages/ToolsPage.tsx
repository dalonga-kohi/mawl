import { useNavigate, useSearch } from '@tanstack/react-router'
import { Plug, Puzzle, Sparkles } from 'lucide-react'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs.tsx'
import { PageShell } from './PageShell.tsx'
import type { ToolsTab } from './search.ts'

const TABS: { id: ToolsTab; label: string }[] = [
  { id: 'connections', label: 'Connections' },
  { id: 'skills', label: 'Skills' },
  { id: 'plugins', label: 'Plugins' },
]

/**
 * Connections, Skills and Plugins (UI-REDESIGN.md §5). The tab lives in `?tab=`.
 * reason: all three are empty on purpose until their data exists: connections arrive with the
 * MCP manager (D2.9), skills with D2.8 and plugin import with D9.3. No button here until then.
 */
export function ToolsPage() {
  const { tab } = useSearch({ from: '/tools' })
  const navigate = useNavigate({ from: '/tools' })
  return (
    <PageShell title="Tools" description="Connect apps, teach skills and add plugins.">
      <Tabs
        value={tab}
        onValueChange={(next) => navigate({ search: { tab: next as ToolsTab }, replace: true })}
        className="gap-6"
      >
        <TabsList aria-label="Tools" className="w-full sm:w-fit">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="sm:min-w-28">
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="connections">
          <EmptyPanel icon={Plug} title="No connections yet">
            Connect an app to let teammates read your calendar, file issues or post updates.
          </EmptyPanel>
        </TabsContent>
        <TabsContent value="skills">
          <EmptyPanel icon={Sparkles} title="No skills yet">
            Skills your teammates learn will show up here.
          </EmptyPanel>
        </TabsContent>
        <TabsContent value="plugins">
          <EmptyPanel icon={Puzzle} title="No plugins yet">
            Plugins bundle skills and connections. Importing them is coming soon.
          </EmptyPanel>
        </TabsContent>
      </Tabs>
    </PageShell>
  )
}
