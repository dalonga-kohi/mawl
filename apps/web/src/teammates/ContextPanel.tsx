import type { Run } from '@mawl/contracts'
import { Activity, BookOpen, Monitor } from 'lucide-react'
import { useState } from 'react'
import { failureCopy } from '../chat/run-copy.ts'
import { EmptyPanel } from '../ui/EmptyPanel.tsx'
import { IconTile } from '../ui/IconTile.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/Tabs.tsx'

const TABS = [
  { id: 'computer', label: 'Computer' },
  { id: 'memory', label: 'Memory' },
  { id: 'run', label: 'Run' },
] as const

const number = new Intl.NumberFormat()

function duration(ms: number): string {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

const STATUS_WORD: Record<Run['status'], string> = {
  queued: 'Starting',
  running: 'Working',
  waiting_approval: 'Waiting for approval',
  waiting_takeover: 'Waiting for you to take over',
  waiting_user: 'Waiting for your answer',
  compacting: 'Tidying notes',
  paused: 'Paused',
  succeeded: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
}

/** The latest run in this conversation as a few plain facts (P2/P3 add steps and memories). */
function RunDetails({ run }: { run: Run | undefined }) {
  if (!run) {
    return (
      <EmptyPanel icon={Activity} title="No run yet">
        Run details show up while a teammate works.
      </EmptyPanel>
    )
  }
  const rows: [string, string][] = [
    ['Status', STATUS_WORD[run.status]],
    ['Time working', duration(run.activeMs)],
    ['Tokens in', number.format(run.usage.inputTokens)],
    ['Tokens out', number.format(run.usage.outputTokens)],
  ]
  return (
    <div className="flex flex-col items-center gap-6 px-2 pt-8">
      <IconTile icon={Activity} />
      <dl className="grid w-full grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-2">{k}</dt>
            <dd className="text-right font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {run.status === 'failed' ? (
        <p className="w-full rounded-lg bg-danger-soft p-3 text-small text-danger">
          {failureCopy(run.error).title}
        </p>
      ) : null}
    </div>
  )
}

/** Computer / Memory / Run (DESIGN.md §5). Computer and Memory contents arrive with P4 and P3.7. */
export function ContextPanelBody({ run }: { run?: Run | undefined }) {
  const [tab, setTab] = useState<string>('computer')
  return (
    <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
      {/* The tabs draw their focus ring inset: the panel clips anything outside a tab. */}
      <TabsList aria-label="Context" className="mx-3.5 mt-3.5 flex">
        {TABS.map((t) => (
          <TabsTrigger key={t.id} value={t.id}>
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overscroll-contain p-3.5">
        <TabsContent value="computer">
          <EmptyPanel icon={Monitor} title="No computer yet">
            The computer starts when a teammate needs it.
          </EmptyPanel>
        </TabsContent>
        <TabsContent value="memory">
          <EmptyPanel icon={BookOpen} title="Nothing remembered yet">
            What this teammate learns about you shows up here.
          </EmptyPanel>
        </TabsContent>
        <TabsContent value="run">
          <RunDetails run={run} />
        </TabsContent>
      </div>
    </Tabs>
  )
}
