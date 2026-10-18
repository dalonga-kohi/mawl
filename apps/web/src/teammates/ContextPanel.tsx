import { Tabs } from 'radix-ui'
import { useState } from 'react'
import { Beaver } from '../mascot/Beaver.tsx'

const TABS = [
  { id: 'computer', label: 'Computer' },
  { id: 'memory', label: 'Memory' },
  { id: 'run', label: 'Run' },
] as const

const note = 'text-small text-text-2'

/** Computer / Memory / Run (DESIGN.md §5). Contents arrive with P4, P3.7 and P1.7. */
export function ContextPanelBody() {
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
          <p className={note}>Run details show up while a teammate works.</p>
        </Tabs.Content>
      </div>
    </Tabs.Root>
  )
}
