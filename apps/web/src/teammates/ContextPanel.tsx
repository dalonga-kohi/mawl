import type { Run } from '@faire/contracts'
import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { failureCopy } from '../chat/run-copy.ts'
import { Beaver } from '../mascot/Beaver.tsx'

const TABS = [
  { id: 'computer', label: 'Computer' },
  { id: 'memory', label: 'Memory' },
  { id: 'run', label: 'Run' },
] as const

const note = 'text-small text-text-2'

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
  if (!run) return <p className={note}>Run details show up while a teammate works.</p>
  const rows: [string, string][] = [
    ['Status', STATUS_WORD[run.status]],
    ['Time working', duration(run.activeMs)],
    ['Tokens in', number.format(run.usage.inputTokens)],
    ['Tokens out', number.format(run.usage.outputTokens)],
  ]
  return (
    <div className="flex flex-col gap-3">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-small">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-2">{k}</dt>
            <dd className="text-right font-semibold tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {run.status === 'failed' ? (
        <p className="rounded-md bg-danger-soft p-3 text-small text-danger">
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
    <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <Tabs.List aria-label="Context" className="flex gap-1 px-3.5 pt-3.5">
        {TABS.map((t) => (
          <Tabs.Trigger
            key={t.id}
            value={t.id}
            // Inset ring: the panel clips anything drawn outside the tab.
            className="h-[34px] pointer-coarse:h-11 flex-1 rounded-sm focus-visible:outline-offset-[-2px] text-small font-semibold text-text-2 transition-colors duration-[120ms] hover:bg-surface-2 data-[state=active]:bg-surface-2 data-[state=active]:text-text"
          >
            {t.label}
          </Tabs.Trigger>
        ))}
      </Tabs.List>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto p-3.5">
        <Tabs.Content value="computer" className="flex flex-col gap-3 outline-none">
          <div className="grid aspect-[16/10] place-items-center rounded-md bg-surface-2">
            <Beaver size={56} state="sleeping" />
          </div>
          <p className={note}>The computer starts when a teammate needs it.</p>
        </Tabs.Content>
        <Tabs.Content value="memory" className="outline-none">
          <p className={note}>Memories a teammate used for its last reply show up here.</p>
        </Tabs.Content>
        <Tabs.Content value="run" className="outline-none">
          <RunDetails run={run} />
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}
