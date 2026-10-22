import { accentPresets, defaultAccent } from '@mawl/ui'
import { Link, useSearch } from '@tanstack/react-router'
import { KeyRound, Laptop, type LucideIcon, Moon, Palette, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { RadioGroup } from 'radix-ui'
import type { ReactNode } from 'react'
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
  { id: 'appearance', label: 'Appearance', icon: Palette },
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

const presetHexes = accentPresets.map((p) => p.hex)
/** The selected swatch: a gap in the card's color, then a ring in the text color. */
const selectedRing = 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--text)]'

function AccentControl() {
  const { appearance, setAccent } = useAppearance()
  const preset = accentPresets.find((p) => p.hex === appearance.accent)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <RadioGroup.Root
          aria-label="Accent color"
          value={preset?.hex ?? ''}
          onValueChange={setAccent}
          orientation="horizontal"
          className="flex flex-wrap gap-3"
        >
          {accentPresets.map((p) => (
            <RadioGroup.Item
              key={p.id}
              value={p.hex}
              aria-label={p.name}
              className="relative size-9 rounded-pill shadow-[inset_0_0_0_1px_var(--line)] transition-transform duration-(--dur-fast) hover:scale-110 active:scale-90 data-[state=checked]:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--text)] pointer-coarse:size-11"
              style={{ background: p.hex }}
            >
              {/* A single ripple from the chosen swatch (DESIGN.md §7). */}
              <AnimatePresence>
                {appearance.accent === p.hex ? (
                  <motion.span
                    key={p.hex}
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-pill"
                    style={{ background: p.hex }}
                    initial={{ scale: 1, opacity: 0.45 }}
                    animate={{
                      scale: 2.2,
                      opacity: 0,
                      transition: { duration: 0.6, ease: 'easeOut' },
                    }}
                  />
                ) : null}
              </AnimatePresence>
            </RadioGroup.Item>
          ))}
        </RadioGroup.Root>
        <span aria-hidden="true" className="h-6 w-px bg-line" />
        <label
          className={cx(
            'relative size-9 cursor-pointer rounded-pill transition-transform duration-(--dur-fast) hover:scale-110 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ring pointer-coarse:size-11',
            !preset && selectedRing,
          )}
          style={{
            background: `conic-gradient(from 0deg, ${[...presetHexes, presetHexes[0]].join(', ')})`,
          }}
        >
          <span className="sr-only">Custom accent color</span>
          <input
            type="color"
            value={appearance.accent.toLowerCase()}
            onChange={(e) => setAccent(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      </div>
      <p aria-live="polite" className="text-small text-text-2">
        {preset
          ? preset.hex === defaultAccent.hex
            ? "Lime is Mawl's own color."
            : `${preset.name}. Mawl itself stays lime.`
          : 'Custom color. Mawl adjusts text and focus rings on it so they stay readable.'}
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
        title="Accent color"
        helper="Tints buttons, selection and highlights."
        layout="stacked"
      >
        <AccentControl />
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
