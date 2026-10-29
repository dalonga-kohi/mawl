import { isPaletteId, type Palette, type PaletteId, paletteList, palettes } from '@mawl/ui'
import { Link, useSearch } from '@tanstack/react-router'
import {
  Check,
  KeyRound,
  Laptop,
  type LucideIcon,
  Moon,
  Palette as PaletteIcon,
  Sun,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { RadioGroup } from 'radix-ui'
import { type ReactNode, useState } from 'react'
import { useAppearance } from '../appearance/AppearanceProvider.tsx'
import type { ThemePref } from '../appearance/prefs.ts'
import { transitions } from '../motion/presets.ts'
import { PageShell } from '../pages/PageShell.tsx'
import type { SettingsSection } from '../pages/search.ts'
import { cx } from '../ui/cx.ts'
import { Switch } from '../ui/Switch.tsx'
import { ModelsSection } from './models/ModelsSection.tsx'
import { SettingCard, SettingsSectionHeader } from './parts.tsx'

const SECTIONS: { id: SettingsSection; label: string; icon: LucideIcon }[] = [
  { id: 'appearance', label: 'Appearance', icon: PaletteIcon },
  { id: 'models', label: 'Models and keys', icon: KeyRound },
]

const THEMES: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <Sun aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon aria-hidden="true" /> },
  { value: 'system', label: 'System', icon: <Laptop aria-hidden="true" /> },
]

function ThemeControl() {
  const { appearance, setTheme } = useAppearance()
  return (
    <RadioGroup.Root
      aria-label="Theme"
      value={appearance.theme}
      onValueChange={(v) => setTheme(v as ThemePref)}
      orientation="horizontal"
      className="relative inline-flex w-full rounded-pill bg-surface-2 p-[3px] md:w-auto"
    >
      {THEMES.map((t) => (
        <RadioGroup.Item
          key={t.value}
          value={t.value}
          aria-label={t.label}
          className="relative inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-pill px-3.5 text-small font-semibold text-text-2 transition-colors duration-(--dur-fast) hover:text-text data-[state=checked]:text-text pointer-coarse:h-11 md:flex-none [&_svg]:size-4"
        >
          {appearance.theme === t.value ? (
            <motion.span
              layoutId="theme-thumb"
              className="absolute inset-0 rounded-pill bg-surface shadow-1"
              transition={transitions.snappy}
            />
          ) : null}
          <span className="relative inline-flex items-center gap-1.5">
            {t.icon}
            {t.label}
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  )
}

/**
 * The selected tile's ring and check use the app's current palette (they sit outside the preview),
 * so the choice reads the same whichever palette is on.
 */
function PaletteTile({
  palette,
  selected,
  theme,
}: {
  palette: Palette
  selected: boolean
  theme: ThemePref
}) {
  return (
    <RadioGroup.Item
      value={palette.id}
      aria-label={palette.name}
      className="group relative flex min-h-11 flex-col gap-2 rounded-[18px] p-1.5 text-left transition-[scale] duration-(--dur-fast) ease-out active:scale-[.97]"
    >
      {selected ? (
        <motion.span
          layoutId="palette-ring"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_0_0_2px_var(--accent-ink)]"
          transition={transitions.snappy}
        />
      ) : null}
      {/* A live miniature: the preview wears the tile's palette in the current theme. */}
      <span
        aria-hidden="true"
        data-palette={palette.id}
        data-theme={theme === 'system' ? undefined : theme}
        className="relative block aspect-[4/3] overflow-hidden rounded-[12px] bg-bg shadow-[inset_0_0_0_1px_var(--line)] transition-[translate,box-shadow] duration-(--dur-fast) ease-out group-hover:-translate-y-0.5 group-hover:shadow-[inset_0_0_0_1px_var(--line),0_10px_24px_-10px_var(--accent)]"
      >
        <span className="absolute inset-y-0 left-0 flex w-[30%] flex-col gap-1.5 bg-surface-2 px-1.5 pt-2.5">
          <span className="h-1.5 w-full rounded-pill bg-accent-soft" />
          <span className="h-1 w-4/5 rounded-pill bg-text-3 opacity-50" />
          <span className="h-1 w-3/5 rounded-pill bg-text-3 opacity-50" />
        </span>
        <span className="absolute top-2.5 right-2 bottom-2.5 left-[calc(30%+8px)] flex flex-col gap-1.5 rounded-[8px] bg-surface p-2 shadow-[inset_0_0_0_1px_var(--line)]">
          <span className="h-1.5 w-3/4 rounded-pill bg-accent-ink" />
          <span className="h-1 w-1/2 rounded-pill bg-text-2 opacity-60" />
          <span className="mt-auto flex items-center gap-1.5">
            <span className="h-3 w-7 rounded-pill bg-accent-fill" />
            <span className="size-2 rounded-pill bg-secondary" />
          </span>
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 px-1 pb-0.5 text-small font-semibold text-text">
        <span className="truncate">{palette.name}</span>
        <AnimatePresence initial={false}>
          {selected ? (
            <motion.span
              key="check"
              aria-hidden="true"
              className="grid size-5 shrink-0 place-items-center rounded-pill bg-accent-fill text-on-accent"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, transition: transitions.snappy }}
              exit={{ scale: 0.5, opacity: 0, transition: transitions.exit }}
            >
              <Check className="size-3.5" strokeWidth={2.5} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
    </RadioGroup.Item>
  )
}

function PaletteControl() {
  const { appearance, setPalette } = useAppearance()
  const [saved, setSaved] = useState<PaletteId | null>(null)
  const savedName = saved ? palettes[saved].name : null
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup.Root
        aria-label="Palette"
        value={appearance.palette}
        onValueChange={(id) => {
          if (!isPaletteId(id)) return
          setPalette(id)
          setSaved(id)
        }}
        className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2"
      >
        {paletteList.map((p) => (
          <PaletteTile
            key={p.id}
            palette={p}
            selected={appearance.palette === p.id}
            theme={appearance.theme}
          />
        ))}
      </RadioGroup.Root>
      {/* The line is always there, so the confirmation never pushes the page down. */}
      <p aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-small text-text-2">
        <AnimatePresence mode="wait" initial={false}>
          {savedName ? (
            <motion.span
              key={savedName}
              className="inline-flex items-center gap-1.5"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0, transition: transitions.fade }}
              exit={{ opacity: 0, transition: transitions.exit }}
            >
              <Check aria-hidden="true" className="size-4 text-secondary-ink" />
              {`${savedName} on. Saved.`}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </p>
    </div>
  )
}
function AppearanceSection() {
  const { appearance, setReduceMotion } = useAppearance()
  return (
    <section aria-labelledby="settings-appearance" className="flex flex-col gap-4">
      <SettingsSectionHeader id="settings-appearance" title="Appearance">
        How Mawl looks on this device.
      </SettingsSectionHeader>
      <SettingCard title="Theme" helper="Follow your system, or pick light or dark.">
        <ThemeControl />
      </SettingCard>
      <SettingCard
        title="Palette"
        helper="Colors for the whole app. Each one has a light and a dark side."
        layout="stacked"
      >
        <PaletteControl />
      </SettingCard>
      <SettingCard
        title="Reduce motion"
        helper="Swap springs and the mascot's animations for simple fades."
        htmlFor="reduce-motion"
      >
        <Switch
          id="reduce-motion"
          checked={appearance.reduceMotion}
          onCheckedChange={setReduceMotion}
        />
      </SettingCard>
    </section>
  )
}

/**
 * The section switcher: pill links in a column beside the content on wide screens, one pill
 * segmented track above it below 760 px. One list of links serves both, so the URL, focus order
 * and screen reader names never differ between sizes.
 */
function SectionNav() {
  return (
    <nav aria-label="Settings sections" className="md:sticky md:top-0 md:self-start">
      <ul className="flex gap-0.5 rounded-pill bg-surface-2 p-[3px] md:flex-col md:bg-transparent md:p-0">
        {SECTIONS.map(({ id, label, icon: Icon }) => (
          <li key={id} className="flex-1 md:flex-none">
            <Link
              to="/settings"
              search={{ section: id }}
              replace
              activeOptions={{ exact: true }}
              className={cx(
                'accent-tween flex h-9 items-center justify-center gap-3 rounded-pill px-3.5 text-small font-semibold text-text-2 whitespace-nowrap active:scale-[.97] pointer-coarse:h-11',
                'hover:text-text aria-[current=page]:bg-surface aria-[current=page]:text-text aria-[current=page]:shadow-1',
                'md:h-10 md:justify-start md:px-3 md:text-body md:font-normal md:text-text md:hover:bg-surface-2',
                'md:aria-[current=page]:bg-surface-2 md:aria-[current=page]:shadow-none',
                '[&_svg]:size-[18px] [&_svg]:shrink-0 [&_svg]:text-text-2 aria-[current=page]:[&_svg]:text-accent-ink',
              )}
            >
              <Icon aria-hidden="true" className="hidden md:block" />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function SettingsPage() {
  const { section } = useSearch({ from: '/settings' })
  return (
    <PageShell title="Settings" description="Make Mawl yours.">
      <div className="grid w-full max-w-[920px] gap-6 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12">
        <SectionNav />
        <div className="min-w-0 max-w-[680px]">
          {section === 'models' ? <ModelsSection /> : <AppearanceSection />}
        </div>
      </div>
    </PageShell>
  )
}
