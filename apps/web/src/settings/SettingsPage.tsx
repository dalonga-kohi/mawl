import { accentPresets } from '@mawl/ui'
import { Laptop, Moon, Sun } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { RadioGroup } from 'radix-ui'
import type { ReactNode } from 'react'
import { useAppearance } from '../appearance/AppearanceProvider.tsx'
import type { ThemePref } from '../appearance/prefs.ts'
import { transitions } from '../motion/presets.ts'
import { PageShell } from '../pages/PageShell.tsx'
import { cx } from '../ui/cx.ts'
import { Switch } from '../ui/Switch.tsx'
import { ModelsSection } from './models/ModelsSection.tsx'

const THEMES: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Laptop aria-hidden="true" /> },
  { value: 'light', label: 'Light', icon: <Sun aria-hidden="true" /> },
  { value: 'dark', label: 'Dark', icon: <Moon aria-hidden="true" /> },
]

/** One row of a settings card: what it is and what it changes on the left, the control on the right. */
function Setting({
  title,
  description,
  htmlFor,
  children,
}: {
  title: string
  description: string
  htmlFor?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line py-3.5 first:border-t-0">
      <div className="max-w-[46ch]">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="block text-body font-semibold">
            {title}
          </label>
        ) : (
          <h3 className="text-body font-semibold">{title}</h3>
        )}
        <p className="text-small text-text-2">{description}</p>
      </div>
      {children}
    </div>
  )
}

function ThemeControl() {
  const { appearance, setTheme } = useAppearance()
  return (
    <RadioGroup.Root
      aria-label="Theme"
      value={appearance.theme}
      onValueChange={(v) => setTheme(v as ThemePref)}
      orientation="horizontal"
      className="relative inline-flex rounded-pill bg-surface-2 p-[3px]"
    >
      {THEMES.map((t) => (
        <RadioGroup.Item
          key={t.value}
          value={t.value}
          aria-label={t.label}
          className="relative inline-flex h-9 pointer-coarse:h-11 items-center gap-1.5 rounded-pill px-3.5 text-small font-semibold text-text-2 transition-colors duration-[200ms] data-[state=checked]:text-text [&_svg]:size-4"
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

function AccentControl() {
  const { appearance, setAccent } = useAppearance()
  const preset = accentPresets.find((p) => p.hex === appearance.accent)
  const isCustom = !preset
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <RadioGroup.Root
        aria-label="Accent color"
        value={preset?.hex ?? ''}
        onValueChange={setAccent}
        orientation="horizontal"
        className="flex flex-wrap gap-2.5"
      >
        {accentPresets.map((p) => (
          <RadioGroup.Item
            key={p.id}
            value={p.hex}
            aria-label={p.name}
            className="relative size-8 pointer-coarse:size-11 rounded-pill transition-transform duration-[200ms] hover:scale-110 active:scale-90 shadow-[inset_0_0_0_1px_var(--line)] data-[state=checked]:shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--text)]"
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
      <label
        className={cx(
          'relative size-8 pointer-coarse:size-11 cursor-pointer rounded-pill transition-transform duration-[200ms] hover:scale-110 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent-ring',
          isCustom && 'shadow-[0_0_0_2px_var(--surface),0_0_0_4px_var(--text)]',
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
  )
}

function ReduceMotionControl() {
  const { appearance, setReduceMotion } = useAppearance()
  return (
    <Switch
      id="reduce-motion"
      checked={appearance.reduceMotion}
      onCheckedChange={setReduceMotion}
    />
  )
}

const card = 'rounded-card bg-surface px-[18px] py-1 shadow-1'
const groupLabel = 'text-small font-semibold text-text-2'

export function SettingsPage() {
  return (
    <PageShell title="Settings" description="Make Mawl yours.">
      <section aria-labelledby="appearance" className="flex max-w-[860px] flex-col gap-2.5">
        <h2 id="appearance" className={groupLabel}>
          Appearance
        </h2>
        <div className={card}>
          <Setting title="Theme" description="Follow your system, or pick light or dark.">
            <ThemeControl />
          </Setting>
          <Setting
            title="Accent color"
            description="Tints buttons, selection and highlights. Pip stays brown."
          >
            <AccentControl />
          </Setting>
          <Setting
            title="Reduce motion"
            description="Swap springs and the mascot's animations for simple fades."
            htmlFor="reduce-motion"
          >
            <ReduceMotionControl />
          </Setting>
        </div>
      </section>
      <ModelsSection />
    </PageShell>
  )
}
